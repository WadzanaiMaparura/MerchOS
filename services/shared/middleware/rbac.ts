/**
 * Role-Based Access Control (RBAC) middleware for MerchOS Lambda handlers.
 *
 * Implements the role × action matrix as defined in the design document.
 * Reads the user's role from the JWT claims injected by the API Gateway
 * Lambda authorizer and returns HTTP 403 if the action is not permitted.
 *
 * Requirements: 2.5, 2.6
 */

import middy from '@middy/core';
import { logger } from './powertools';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/** MerchOS user roles, ordered from least to most privileged. */
export type Role = 'viewer' | 'editor' | 'admin' | 'owner';

/** Actions that can be gated by RBAC. */
export type Action =
  | 'view-products'
  | 'upload-products'
  | 'approve-attributes'
  | 'export-listings'
  | 'connect-integrations'
  | 'manage-users'
  | 'manage-billing'
  | 'manage-webhooks'
  | 'manage-inventory';

// ---------------------------------------------------------------------------
// RBAC matrix
// ---------------------------------------------------------------------------

/**
 * Maps each role to the set of actions it is permitted to perform.
 * Owner has all permissions. Each lower role is a strict subset.
 */
const ROLE_PERMISSIONS: Record<Role, ReadonlySet<Action>> = {
  viewer: new Set<Action>(['view-products']),
  editor: new Set<Action>([
    'view-products',
    'upload-products',
    'approve-attributes',
    'export-listings',
    'manage-inventory',
  ]),
  admin: new Set<Action>([
    'view-products',
    'upload-products',
    'approve-attributes',
    'export-listings',
    'connect-integrations',
    'manage-inventory',
    'manage-webhooks',
  ]),
  owner: new Set<Action>([
    'view-products',
    'upload-products',
    'approve-attributes',
    'export-listings',
    'connect-integrations',
    'manage-users',
    'manage-billing',
    'manage-inventory',
    'manage-webhooks',
  ]),
};

/**
 * Check whether a given role is permitted to perform a given action.
 */
export function isActionPermitted(role: Role, action: Action): boolean {
  const permissions = ROLE_PERMISSIONS[role];
  return permissions !== undefined && permissions.has(action);
}

// ---------------------------------------------------------------------------
// Middleware
// ---------------------------------------------------------------------------

interface RbacForbiddenResponse {
  statusCode: 403;
  body: string;
}

/**
 * Middy middleware that enforces RBAC for a required action.
 *
 * Reads the user's role from the API Gateway authorizer context
 * (event.requestContext.authorizer.lambda.role) and checks against
 * the RBAC matrix. Returns HTTP 403 immediately if the role is not
 * permitted to perform the action.
 *
 * @param requiredAction - The action that the protected endpoint requires
 */
export function rbacMiddleware(requiredAction: Action): middy.MiddlewareObj {
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

    const role = (lambda?.['role'] as Role) ?? undefined;

    if (!role || !isActionPermitted(role, requiredAction)) {
      logger.warn('RBAC denied', {
        role: role ?? 'undefined',
        requiredAction,
      });

      const response: RbacForbiddenResponse = {
        statusCode: 403,
        body: JSON.stringify({
          code: 'FORBIDDEN',
          message: `Role '${role ?? 'unknown'}' is not permitted to perform action '${requiredAction}'`,
        }),
      };

      // Short-circuit the handler — return the 403 response directly
      request.response = response as unknown as typeof request.response;
      return response;
    }
  };

  return { before };
}
