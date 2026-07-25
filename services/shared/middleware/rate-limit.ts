/**
 * Rate Limiting middleware for MerchOS Lambda handlers.
 *
 * Implements a DynamoDB-based sliding window rate limiter that supports
 * per-user and per-IP throttling. Uses atomic counter increments (ADD)
 * and TTL-based auto-cleanup for window records.
 *
 * Requirements: FR-15.3, NFR-2
 */

import middy from '@middy/core';
import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { DynamoDBDocumentClient, UpdateCommand } from '@aws-sdk/lib-dynamodb';
import { logger } from './powertools';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/**
 * Configuration options for the rate limit middleware.
 */
export interface RateLimitOptions {
  /** Maximum number of requests allowed within the window. Default: 100. */
  maxRequests?: number;
  /** Window duration in seconds. Default: 60. */
  windowSeconds?: number;
  /**
   * Function to extract the rate limit identifier from the event.
   * Default: extract userId from authorizer context, fallback to source IP.
   */
  identifierFn?: (event: Record<string, unknown>) => string;
}

/**
 * Rate limit error response body.
 */
export interface RateLimitErrorResponse {
  error: {
    code: 'RATE_LIMIT_EXCEEDED';
    message: string;
  };
  retryAfter: number;
}

// ---------------------------------------------------------------------------
// Auth Event Emission (lazy-loaded to avoid cross-package compile dependency)
// ---------------------------------------------------------------------------

/**
 * Lazily loads and invokes `emitAuthEvent` from the auth service.
 * Uses a runtime require to avoid TypeScript rootDir violations while still
 * supporting the auth.security.rate-limit event emission at runtime.
 *
 * Falls back silently if the module is unavailable (e.g., during testing).
 */
async function emitRateLimitEvent(detail: Record<string, unknown>): Promise<void> {
  try {
    // Dynamic path construction prevents TypeScript from resolving the import
    // at compile time, avoiding rootDir violations in the shared package.
    const modulePath = ['..', '..', 'auth', 'utils', 'event-emitter'].join('/');
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const { emitAuthEvent } = require(modulePath) as {
      emitAuthEvent: (opts: { detailType: string; detail: Record<string, unknown> }) => Promise<unknown>;
    };
    await emitAuthEvent({
      detailType: 'auth.security.rate-limit',
      detail,
    });
  } catch (err) {
    logger.error('Failed to emit rate-limit event', {
      error: err instanceof Error ? err.message : String(err),
    });
  }
}

// ---------------------------------------------------------------------------
// DynamoDB Client (singleton for connection reuse across invocations)
// ---------------------------------------------------------------------------

let docClientInstance: DynamoDBDocumentClient | null = null;

function getDocClient(): DynamoDBDocumentClient {
  if (!docClientInstance) {
    const client = new DynamoDBClient({});
    docClientInstance = DynamoDBDocumentClient.from(client, {
      marshallOptions: { removeUndefinedValues: true },
    });
  }
  return docClientInstance;
}

/** @internal Reset cached client (for testing only) */
export function _resetClientForTesting(): void {
  docClientInstance = null;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Default identifier extraction function.
 * Attempts to extract userId from JWT authorizer context, falls back to source IP.
 */
function defaultIdentifierFn(event: Record<string, unknown>): string {
  const requestContext = event['requestContext'] as
    | Record<string, unknown>
    | undefined;
  const authorizer = requestContext?.['authorizer'] as
    | Record<string, unknown>
    | undefined;

  // Try JWT authorizer pattern
  const jwt = authorizer?.['jwt'] as Record<string, unknown> | undefined;
  if (jwt) {
    const claims = jwt['claims'] as Record<string, unknown> | undefined;
    const sub = claims?.['sub'] as string | undefined;
    if (sub) {
      return `USER#${sub}`;
    }
  }

  // Try Lambda authorizer pattern
  const lambda = authorizer?.['lambda'] as Record<string, unknown> | undefined;
  if (lambda) {
    const sub = lambda['sub'] as string | undefined;
    if (sub) {
      return `USER#${sub}`;
    }
  }

  // Fallback to source IP
  const http = requestContext?.['http'] as Record<string, unknown> | undefined;
  const sourceIp = http?.['sourceIp'] as string | undefined;
  if (sourceIp) {
    return `IP#${sourceIp}`;
  }

  // Last resort: check identity.sourceIp (REST API pattern)
  const identity = requestContext?.['identity'] as Record<string, unknown> | undefined;
  const identityIp = identity?.['sourceIp'] as string | undefined;
  if (identityIp) {
    return `IP#${identityIp}`;
  }

  return 'IP#unknown';
}

/**
 * Computes the window identifier based on the current time and window duration.
 * Windows are aligned to epoch boundaries for consistent bucketing.
 */
function getWindowId(nowSeconds: number, windowSeconds: number): string {
  const windowStart = Math.floor(nowSeconds / windowSeconds) * windowSeconds;
  return `${windowStart}`;
}

/**
 * Increments the request counter for the given identifier and window.
 * Uses DynamoDB atomic ADD to avoid race conditions.
 *
 * @returns The new counter value after increment.
 */
async function incrementCounter(
  tableName: string,
  identifier: string,
  windowId: string,
  windowSeconds: number,
  nowSeconds: number,
): Promise<number> {
  const docClient = getDocClient();

  const windowStart = Math.floor(nowSeconds / windowSeconds) * windowSeconds;
  // TTL: expire the record after the window ends plus a small buffer
  const expiresAt = windowStart + windowSeconds + 60;

  const result = await docClient.send(
    new UpdateCommand({
      TableName: tableName,
      Key: {
        PK: identifier,
        SK: `WINDOW#${windowId}`,
      },
      UpdateExpression:
        'ADD #count :inc SET #windowStart = if_not_exists(#windowStart, :ws), #expiresAt = :ttl',
      ExpressionAttributeNames: {
        '#count': 'count',
        '#windowStart': 'windowStart',
        '#expiresAt': 'expiresAt',
      },
      ExpressionAttributeValues: {
        ':inc': 1,
        ':ws': windowStart,
        ':ttl': expiresAt,
      },
      ReturnValues: 'UPDATED_NEW',
    }),
  );

  return (result.Attributes?.['count'] as number) ?? 1;
}

// ---------------------------------------------------------------------------
// Middleware
// ---------------------------------------------------------------------------

/**
 * Middy middleware that enforces per-user/per-IP rate limiting using a
 * DynamoDB sliding window counter.
 *
 * Requires the `RATE_LIMITS_TABLE` environment variable to be set.
 *
 * On rate limit exceeded:
 * - Returns HTTP 429 with `RATE_LIMIT_EXCEEDED` error code
 * - Sets `Retry-After` header with seconds until window resets
 * - Emits `auth.security.rate-limit` event to EventBridge
 *
 * @param options - Rate limit configuration (maxRequests, windowSeconds, identifierFn)
 */
export function rateLimitMiddleware(options: RateLimitOptions = {}): middy.MiddlewareObj {
  const {
    maxRequests = 100,
    windowSeconds = 60,
    identifierFn = defaultIdentifierFn,
  } = options;

  const before: middy.MiddlewareFn = async (request) => {
    const tableName = process.env['RATE_LIMITS_TABLE'];
    if (!tableName) {
      logger.warn('RATE_LIMITS_TABLE not set — rate limiting disabled');
      return;
    }

    const event = request.event as Record<string, unknown>;
    const identifier = identifierFn(event);

    const nowSeconds = Math.floor(Date.now() / 1000);
    const windowId = getWindowId(nowSeconds, windowSeconds);

    let currentCount: number;
    try {
      currentCount = await incrementCounter(
        tableName,
        identifier,
        windowId,
        windowSeconds,
        nowSeconds,
      );
    } catch (err) {
      // If DynamoDB is unavailable, fail open (allow request)
      logger.error('Rate limit counter increment failed — allowing request', {
        error: err instanceof Error ? err.message : String(err),
        identifier,
      });
      return;
    }

    if (currentCount > maxRequests) {
      // Calculate seconds until the current window resets
      const windowStart = Math.floor(nowSeconds / windowSeconds) * windowSeconds;
      const retryAfter = windowStart + windowSeconds - nowSeconds;

      logger.warn('Rate limit exceeded', {
        identifier,
        currentCount,
        maxRequests,
        windowId,
        retryAfter,
      });

      // Emit security event (fire-and-forget)
      emitRateLimitEvent({
        identifier,
        requestCount: currentCount,
        maxRequests,
        windowSeconds,
        windowId,
        timestamp: new Date().toISOString(),
      }).catch(() => {
        // Already logged inside emitRateLimitEvent
      });

      const body: RateLimitErrorResponse = {
        error: {
          code: 'RATE_LIMIT_EXCEEDED',
          message: `Rate limit exceeded. Maximum ${maxRequests} requests per ${windowSeconds} seconds.`,
        },
        retryAfter,
      };

      const response = {
        statusCode: 429,
        headers: {
          'Content-Type': 'application/json',
          'Retry-After': String(retryAfter),
        },
        body: JSON.stringify(body),
      };

      request.response = response as unknown as typeof request.response;
      return response;
    }

    logger.debug('Rate limit check passed', {
      identifier,
      currentCount,
      maxRequests,
    });

    return;
  };

  return { before };
}
