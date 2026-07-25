'use client';

/**
 * Authenticated fetch wrapper for MerchOS API calls.
 * Automatically attaches Bearer tokens and handles 401 retry with token refresh.
 *
 * Implements FR-14.1: API client SHALL attach Bearer token to all API requests automatically.
 * Implements FR-14.2: API client SHALL intercept 401 responses and attempt token refresh.
 * Implements FR-14.3: API client SHALL redirect to login if refresh fails.
 */

export interface AuthenticatedFetchOptions extends RequestInit {
  baseUrl?: string;
}

export type AuthenticatedFetch = (
  url: string,
  options?: AuthenticatedFetchOptions
) => Promise<Response>;

/**
 * Creates a fetch wrapper that automatically attaches authorization headers
 * and retries on 401 responses after refreshing the token.
 *
 * @param getAccessToken - Function to retrieve the current access token.
 *   Called with no args for the initial request; if a 401 occurs, a force-refresh
 *   is triggered by calling it again.
 * @param onUnauthorized - Callback invoked when refresh fails (redirect to login).
 */
export function createAuthenticatedFetch(
  getAccessToken: () => Promise<string | null>,
  onUnauthorized: () => void
): AuthenticatedFetch {
  return async (url: string, options: AuthenticatedFetchOptions = {}): Promise<Response> => {
    const { baseUrl, headers: customHeaders, ...fetchOptions } = options;

    const fullUrl = baseUrl ? `${baseUrl}${url}` : url;

    // Get the current access token
    const token = await getAccessToken();

    const headers = new Headers(customHeaders as HeadersInit);
    if (token) {
      headers.set('Authorization', `Bearer ${token}`);
    }

    // Make the initial request
    const response = await fetch(fullUrl, {
      ...fetchOptions,
      headers,
    });

    // If not 401, return response as-is
    if (response.status !== 401) {
      return response;
    }

    // 401 received — attempt token refresh (force refresh)
    try {
      const refreshedToken = await getAccessToken();

      if (!refreshedToken) {
        onUnauthorized();
        return response;
      }

      // Retry with refreshed token (once)
      const retryHeaders = new Headers(customHeaders as HeadersInit);
      retryHeaders.set('Authorization', `Bearer ${refreshedToken}`);

      return await fetch(fullUrl, {
        ...fetchOptions,
        headers: retryHeaders,
      });
    } catch {
      // Refresh failed — trigger unauthorized flow
      onUnauthorized();
      return response;
    }
  };
}
