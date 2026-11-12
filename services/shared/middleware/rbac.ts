/**
 * Role-Based Access Control (RBAC) middleware for MerchOS Lambda handlers.
 *
 * Uses the centralized @merch-os/rbac package for permission evaluation.
 * Reads the user's role from the JWT claims provided by the API Gateway
 * HTTP API JWT authorizer and returns HTTP 401/403 if authentication/authorization fails.
 *
 * Requirements: 1.1, 1.2, 1.3, 1.4, 1.5, 1.6, 3.1, 3.2, 3.3, 3.4, 3.5, 3.6
 */

import middy from '@middy/core';
import {
  PermissionRegistry,
  defaultPermissionConfig,
  createAuthorizationCheck,
} from '@merch-os/rbac';
import type {
  EndpointPermission,
  AuthorizationContext,
  AuthErrorResponse,
  JwtClaims,
} from '@merch-os/rbac';
import { logger } from './powertools';

// ---------------------------------------------------------------------------
// Module-level registry and authorization check (lazy initialization)
// ---------------------------------------------------------------------------

let _authorize: ReturnType<typeof createAuthorizationCheck> | null = null;

function getAuthorize() {
  if (!_authorize) {
    const expectedIssuer = process.env['COGNITO_ISSUER'] ?? '';
    const registry = new PermissionRegistry(defaultPermissionConfig);
    _authorize = createAuthorizationCheck(registry, expectedIssuer);
  }
  return _authorize;
}

/** @internal Reset cached authorize function (for testing only) */
export function _resetForTesting(): void {
  _authorize = null;
}

// ---------------------------------------------------------------------------
// Re-exports for convenience
// ---------------------------------------------------------------------------

export type { EndpointPermission, AuthorizationContext, AuthErrorResponse };

// ---------------------------------------------------------------------------
// Middleware
// ---------------------------------------------------------------------------

/**
 * Middy middleware that enforces RBAC for a required endpoint permission.
 *
 * Reads the user's JWT claims from the API Gateway HTTP API JWT authorizer
 * context (event.requestContext.authorizer.jwt.claims) and uses
 * `createAuthorizationCheck` from `@merch-os/rbac` to validate the user's
 * role against the endpoint's required permission.
 *
 * On success: attaches `AuthorizationContext` to `event.requestContext.authorizer.rbac`
 * On failure: short-circuits with HTTP 401 or 403 and a structured JSON error body.
 *
 * @param endpointPermission - The resource + action required by this endpoint
 */
export function rbacMiddleware(endpointPermission: EndpointPermission): middy.MiddlewareObj {
  const before: middy.MiddlewareFn = async (request) => {
    const event = request.event as Record<string, unknown>;

    const requestContext = event['requestContext'] as
      | Record<string, unknown>
      | undefined;
    const authorizer = requestContext?.['authorizer'] as
      | Record<string, unknown>
      | undefined;

    // Extract JWT claims from the API Gateway HTTP API JWT authorizer context
    const claims = extractClaims(authorizer);

    // Run authorization check
    const result = getAuthorize()(claims, endpointPermission);

    if (!result.authorized) {
      logger.warn('RBAC denied', {
        status: result.status,
        errorCode: result.body.error.code,
        resource: endpointPermission.resource,
        action: endpointPermission.action,
      });

      const response = {
        statusCode: result.status,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(result.body),
      };

      // Short-circuit the handler — return the error response directly
      request.response = response as unknown as typeof request.response;
      return response;
    }

    // Attach authorization context for downstream handlers
    if (!requestContext) {
      (event as Record<string, unknown>)['requestContext'] = { authorizer: { rbac: result.context } };
    } else if (!authorizer) {
      (requestContext as Record<string, unknown>)['authorizer'] = { rbac: result.context };
    } else {
      (authorizer as Record<string, unknown>)['rbac'] = result.context;
    }

    logger.info('RBAC granted', {
      role: result.context.role,
      userId: result.context.userId,
      resource: endpointPermission.resource,
      action: endpointPermission.action,
    });

    return;
  };

  return { before };
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Extract JwtClaims from the API Gateway HTTP API JWT authorizer context.
 * For HTTP API JWT authorizer: event.requestContext.authorizer.jwt.claims
 */
function extractClaims(authorizer: Record<string, unknown> | undefined): JwtClaims | null {
  if (!authorizer) {
    return null;
  }

  // HTTP API JWT authorizer: authorizer.jwt.claims
  const jwt = authorizer['jwt'] as Record<string, unknown> | undefined;
  const claimsObj = jwt?.['claims'] as Record<string, unknown> | undefined;

  if (!claimsObj) {
    return null;
  }

  const sub = claimsObj['sub'] as string | undefined;
  const iss = claimsObj['iss'] as string | undefined;
  const exp = claimsObj['exp'] as number | undefined;

  // If essential claims are missing, treat as no JWT
  if (!sub || !iss || exp === undefined) {
    return null;
  }

  // Normalise cognito:groups to a string[]. It can arrive in several shapes:
  //   1. A real array (direct JWT decode / some authorizers): ["Seller"]
  //   2. A JSON-encoded string array: '["Seller","Admin"]'
  //   3. The API Gateway HTTP API JWT authorizer form: a bracketed,
  //      space-delimited string like '[Seller]' or '[Seller Admin]' — NOT valid
  //      JSON. This is AWS's documented array->string conversion and was the
  //      previously-unhandled case that caused spurious MISSING_GROUP errors.
  const groups = normaliseGroups(claimsObj['cognito:groups']);

  const tenantId = claimsObj['custom:tenantId'] as string | undefined;

  const claims: JwtClaims = {
    sub,
    iss,
    exp,
    ...(groups !== undefined && { 'cognito:groups': groups }),
    ...(tenantId !== undefined && { 'custom:tenantId': tenantId }),
  };

  return claims;
}

/**
 * Normalise a raw `cognito:groups` claim value into a string[] (or undefined).
 *
 * Handles every shape the claim can arrive in:
 *  - a real array                → returned as-is
 *  - a JSON array string         → JSON.parse
 *  - the API Gateway authorizer bracketed form '[Seller Admin]' or '[Seller]'
 *    (space- or comma-delimited, NOT JSON) → strip brackets and split
 *  - a plain delimited string    → split on comma/space
 */
function normaliseGroups(raw: unknown): string[] | undefined {
  if (Array.isArray(raw)) {
    const arr = raw.filter((g): g is string => typeof g === 'string');
    return arr.length ? arr : undefined;
  }
  if (typeof raw !== 'string') return undefined;

  const trimmed = raw.trim();
  if (trimmed === '' || trimmed === '[]') return undefined;

  // JSON array form: '["Seller","Admin"]'
  if (trimmed.startsWith('[') && trimmed.includes('"')) {
    try {
      const parsed = JSON.parse(trimmed);
      if (Array.isArray(parsed)) {
        const arr = parsed.filter((g): g is string => typeof g === 'string');
        return arr.length ? arr : undefined;
      }
    } catch {
      // fall through to delimited parsing
    }
  }

  // Bracketed/delimited form: '[Seller Admin]', '[Seller]', 'Seller,Admin'
  const inner = trimmed.replace(/^\[/, '').replace(/\]$/, '');
  const parts = inner
    .split(/[\s,]+/)
    .map((s) => s.trim())
    .filter(Boolean);
  return parts.length ? parts : undefined;
}
