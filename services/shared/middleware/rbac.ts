/**
 * Role-Based Access Control (RBAC) middleware for MerchOS Lambda handlers.
 *
 * Uses the centralized @merch-os/rbac package for permission evaluation.
 * Reads the user's role from the JWT claims injected by the API Gateway
 * Lambda authorizer and returns HTTP 401/403 if authentication/authorization fails.
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
 * Reads the user's JWT claims from the API Gateway authorizer context
 * (event.requestContext.authorizer.lambda) and uses `createAuthorizationCheck`
 * from `@merch-os/rbac` to validate the user's role against the endpoint's
 * required permission.
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
    const lambda = authorizer?.['lambda'] as
      | Record<string, unknown>
      | undefined;

    // Extract JWT claims from the API Gateway authorizer context
    const claims = extractClaims(lambda);

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
 * Extract JwtClaims from the API Gateway Lambda authorizer context.
 * The authorizer puts decoded JWT claims as individual fields in the lambda object.
 */
function extractClaims(lambda: Record<string, unknown> | undefined): JwtClaims | null {
  if (!lambda) {
    return null;
  }

  const sub = lambda['sub'] as string | undefined;
  const iss = lambda['iss'] as string | undefined;
  const exp = lambda['exp'] as number | undefined;

  // If essential claims are missing, treat as no JWT
  if (!sub || !iss || exp === undefined) {
    return null;
  }

  // cognito:groups may come as a JSON-encoded string array or an actual array
  let groups: string[] | undefined;
  const rawGroups = lambda['cognito:groups'];
  if (Array.isArray(rawGroups)) {
    groups = rawGroups as string[];
  } else if (typeof rawGroups === 'string') {
    try {
      const parsed = JSON.parse(rawGroups);
      if (Array.isArray(parsed)) {
        groups = parsed;
      }
    } catch {
      // Not valid JSON, ignore
    }
  }

  const tenantId = lambda['custom:tenantId'] as string | undefined;

  const claims: JwtClaims = {
    sub,
    iss,
    exp,
    ...(groups !== undefined && { 'cognito:groups': groups }),
    ...(tenantId !== undefined && { 'custom:tenantId': tenantId }),
  };

  return claims;
}
