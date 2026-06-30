import axios, {
  AxiosError,
  AxiosInstance,
  InternalAxiosRequestConfig,
} from 'axios';
import { ApiError, normalizeError } from './errors';

/**
 * Configuration for creating an API client instance.
 */
export interface ApiClientConfig {
  /** Base URL for the API (e.g., 'https://api.merchos.io/v1') */
  baseUrl: string;
  /** Async function to retrieve the current access token */
  getAccessToken: () => Promise<string>;
  /** Callback invoked when the session is irrecoverably unauthorized */
  onUnauthorized: () => void;
}

/** Maximum number of retries for network errors */
const MAX_RETRIES = 3;

/** Base delay for exponential backoff in milliseconds */
const BASE_DELAY_MS = 1000;

/** Maximum Retry-After duration cap in seconds */
const MAX_RETRY_AFTER_SECONDS = 60;

/** Fallback delay when Retry-After header is missing or invalid */
const FALLBACK_RETRY_AFTER_MS = 5000;

/** Request timeout in milliseconds */
const REQUEST_TIMEOUT_MS = 15_000;

/**
 * Custom config property to track retry state across interceptor cycles.
 */
interface RetryMeta {
  _retryCount?: number;
  _isRetryAfterAuth?: boolean;
}

type RequestConfigWithRetry = InternalAxiosRequestConfig & RetryMeta;

/**
 * Delays execution for the specified duration.
 */
function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Parses the Retry-After header value.
 * Supports both seconds (integer) and HTTP-date formats.
 * Returns delay in milliseconds, capped at MAX_RETRY_AFTER_SECONDS * 1000.
 * Returns null if the header is missing or invalid.
 */
function parseRetryAfter(headerValue: string | undefined | null): number | null {
  if (!headerValue) {
    return null;
  }

  // Try parsing as integer seconds
  const seconds = Number(headerValue);
  if (!Number.isNaN(seconds) && seconds >= 0) {
    const capped = Math.min(seconds, MAX_RETRY_AFTER_SECONDS);
    return capped * 1000;
  }

  // Try parsing as HTTP-date
  const date = new Date(headerValue);
  if (!Number.isNaN(date.getTime())) {
    const delayMs = date.getTime() - Date.now();
    if (delayMs <= 0) return 0;
    return Math.min(delayMs, MAX_RETRY_AFTER_SECONDS * 1000);
  }

  return null;
}

/**
 * Creates and returns a configured Axios instance with:
 * - Bearer token authorization via request interceptor
 * - 401 handling with token refresh and single retry
 * - Network error retry with exponential backoff (1s, 2s, 4s)
 * - HTTP 429 handling with Retry-After header support
 * - 15-second request timeout
 */
export function createApiClient(config: ApiClientConfig): AxiosInstance {
  const { baseUrl, getAccessToken, onUnauthorized } = config;

  const client = axios.create({
    baseURL: baseUrl,
    timeout: REQUEST_TIMEOUT_MS,
    headers: {
      'Content-Type': 'application/json',
    },
  });

  // ─── Request Interceptor: Attach Bearer Token ───────────────────────
  client.interceptors.request.use(
    async (requestConfig: InternalAxiosRequestConfig) => {
      try {
        const token = await getAccessToken();
        if (token) {
          requestConfig.headers.set('Authorization', `Bearer ${token}`);
        }
      } catch {
        // If we can't get a token, proceed without one — the response
        // interceptor will handle any resulting 401.
      }
      return requestConfig;
    },
    (error: unknown) => Promise.reject(error)
  );

  // ─── Response Interceptor: Error Handling ────────────────────────────
  client.interceptors.response.use(
    (response) => response,
    async (error: unknown) => {
      if (!(error instanceof AxiosError)) {
        throw normalizeError(error);
      }

      const originalRequest = error.config as RequestConfigWithRetry | undefined;
      if (!originalRequest) {
        throw normalizeError(error);
      }

      const retryCount = originalRequest._retryCount ?? 0;

      // ── Handle network errors (no response): retry with exponential backoff ──
      if (!error.response) {
        if (retryCount < MAX_RETRIES) {
          originalRequest._retryCount = retryCount + 1;
          const backoffDelay = BASE_DELAY_MS * Math.pow(2, retryCount);
          await delay(backoffDelay);
          return client.request(originalRequest);
        }
        // All retries exhausted
        throw normalizeError(error);
      }

      const status = error.response.status;

      // ── Handle 401 Unauthorized: refresh token and retry once ──
      if (status === 401 && !originalRequest._isRetryAfterAuth) {
        originalRequest._isRetryAfterAuth = true;
        try {
          const newToken = await getAccessToken();
          originalRequest.headers.set('Authorization', `Bearer ${newToken}`);
          return client.request(originalRequest);
        } catch {
          // Token refresh failed — session is irrecoverable
          onUnauthorized();
          throw normalizeError(error);
        }
      }

      // ── Handle 429 Too Many Requests: wait Retry-After and retry ──
      if (status === 429 && retryCount < MAX_RETRIES) {
        const retryAfterHeader = error.response.headers?.['retry-after'] as
          | string
          | undefined;
        const waitMs = parseRetryAfter(retryAfterHeader) ?? FALLBACK_RETRY_AFTER_MS;

        originalRequest._retryCount = retryCount + 1;
        await delay(waitMs);
        return client.request(originalRequest);
      }

      // ── Handle timeout (ECONNABORTED) ──
      if (error.code === 'ECONNABORTED' || error.code === 'ERR_CANCELED') {
        const apiError: ApiError = {
          statusCode: 0,
          message: 'Request timed out. Please try again.',
          requestId: '',
          code: 'TIMEOUT',
        };
        throw apiError;
      }

      // ── All other errors: normalize and throw ──
      throw normalizeError(error);
    }
  );

  return client;
}
