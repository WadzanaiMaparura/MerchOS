import type { Action } from './types';
import { PermissionRegistry } from './registry';
import { resolveRoleFromClaims } from './jwt';
import type { JwtClaims } from './jwt';

/** Endpoint authorization annotation */
export interface EndpointPermission {
  resource: string;
  action: Action;
}

/** Context attached to request after successful authorization */
export interface AuthorizationContext {
  role: string;
  userId: string;
  tenantId?: string;
}

/** Structured error response for 401/403 */
export interface AuthErrorResponse {
  error: {
    code: string;
    message: string;
  };
}

/**
 * Creates an authorization middleware function.
 * Framework-agnostic: returns a check function that can be adapted
 * to Express, API Gateway Lambda authorizer, or Next.js middleware.
 */
export function createAuthorizationCheck(
  registry: PermissionRegistry,
  expectedIssuer: string,
) {
  return function authorize(
    claims: JwtClaims | null,
    endpoint: EndpointPermission,
  ): { authorized: true; context: AuthorizationContext } | { authorized: false; status: 401 | 403; body: AuthErrorResponse } {
    // No claims = no JWT provided
    if (!claims) {
      return {
        authorized: false,
        status: 401,
        body: { error: { code: 'MISSING_TOKEN', message: 'Authentication required' } },
      };
    }

    // Resolve role from claims
    const resolution = resolveRoleFromClaims(claims, expectedIssuer);
    if (!resolution.success) {
      return {
        authorized: false,
        status: resolution.httpStatus,
        body: { error: { code: resolution.errorCode, message: resolution.message } },
      };
    }

    // Check permission
    const check = registry.hasPermission(resolution.role, endpoint.resource, endpoint.action);
    if (!check.granted) {
      return {
        authorized: false,
        status: 403,
        body: { error: { code: 'INSUFFICIENT_PERMISSIONS', message: check.reason ?? 'Access denied' } },
      };
    }

    return {
      authorized: true,
      context: {
        role: resolution.role,
        userId: resolution.userId,
        tenantId: resolution.tenantId,
      },
    };
  };
}
