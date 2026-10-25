/**
 * Access-token enforcement middleware for MerchOS Lambda handlers.
 *
 * The API Gateway HTTP API JWT authorizer validates a token's signature,
 * issuer, expiry, and audience — but it cannot distinguish a Cognito ID token
 * from an access token. For the seller app client, a Cognito ID token carries
 * `aud` = client id and an access token carries `client_id` = client id, so
 * BOTH token types satisfy the authorizer's audience check and reach the
 * handler. ID tokens are an authentication artifact (and carry user-mutable
 * profile attributes), so protected API routes must accept access tokens only.
 *
 * Cognito stamps every token with a `token_use` claim (`"access"` or `"id"`).
 * This middleware rejects any request whose validated JWT claims are not an
 * access token, short-circuiting with HTTP 401 before any downstream
 * authorization (RBAC), tenant-context, input-validation, or business logic
 * runs.
 *
 * Scope-based route authorization is intentionally NOT used: the login flow
 * (AdminInitiateAuth / USER_PASSWORD_AUTH) does not issue custom OAuth scopes,
 * so requiring scopes would reject legitimate requests. `token_use` is present
 * on every access token regardless of flow and is the reliable discriminator.
 *
 * This middleware does not read, validate, or weaken signature, issuer,
 * expiry, tenant-isolation, role, or group checks — those remain the
 * responsibility of the authorizer and the RBAC/tenant-context middleware.
 */

import middy from '@middy/core';
import { logger } from './powertools';

// ---------------------------------------------------------------------------
// Middleware
// ---------------------------------------------------------------------------

/**
 * Middy middleware that enforces access-token-only use on a protected route.
 *
 * Reads the validated JWT claims from the API Gateway HTTP API JWT authorizer
 * context (event.requestContext.authorizer.jwt.claims). If the `token_use`
 * claim is not exactly `"access"` (ID token, missing, or any other value), the
 * request is rejected with HTTP 401 and a structured JSON error body, and the
 * handler never executes.
 *
 * Register this BEFORE any authorization/business middleware so non-access
 * tokens are rejected first.
 */
export function accessTokenMiddleware(): middy.MiddlewareObj {
  const before: middy.MiddlewareFn = async (request) => {
    const event = request.event as Record<string, unknown>;

    const requestContext = event['requestContext'] as
      | Record<string, unknown>
      | undefined;
    const authorizer = requestContext?.['authorizer'] as
      | Record<string, unknown>
      | undefined;
    const jwt = authorizer?.['jwt'] as Record<string, unknown> | undefined;
    const claims = jwt?.['claims'] as Record<string, unknown> | undefined;

    const tokenUse = claims?.['token_use'];

    if (tokenUse !== 'access') {
      logger.warn('Access-token enforcement: non-access token rejected', {
        // token_use is a non-sensitive enum ('id' | 'access'); never log PII.
        tokenUse: typeof tokenUse === 'string' ? tokenUse : null,
      });

      const response = {
        statusCode: 401,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          error: { code: 'UNAUTHORIZED', message: 'No valid session found' },
        }),
      };

      // Short-circuit — return the error response directly, skipping the handler.
      request.response = response as unknown as typeof request.response;
      return response;
    }

    return;
  };

  return { before };
}
