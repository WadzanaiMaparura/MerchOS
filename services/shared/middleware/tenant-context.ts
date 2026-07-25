/**
 * Tenant Context middleware for MerchOS Lambda handlers.
 *
 * Extracts tenantId from JWT claims (supports both JWT and Lambda authorizer
 * patterns), validates tenant isolation, and attaches tenant context to the
 * request for downstream handlers.
 *
 * Platform Admin/Support roles bypass tenant validation to allow cross-tenant access.
 *
 * Requirements: FR-3.1, FR-3.2, FR-3.4, FR-5.1, FR-5.2, FR-5.3, FR-5.4, FR-15.2
 */

import middy from '@middy/core';
import { logger } from './powertools';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface TenantContext {
  tenantId: string;
}

/** Roles that can bypass tenant isolation (platform-level access) */
const BYPASS_ROLES: ReadonlySet<string> = new Set(['Admin', 'Support']);

// ---------------------------------------------------------------------------
// Middleware
// ---------------------------------------------------------------------------

/**
 * Middy middleware that extracts and validates tenant context from JWT claims.
 *
 * Reads `custom:tenantId` from either:
 *   - event.requestContext.authorizer.jwt.claims['custom:tenantId'] (JWT authorizer)
 *   - event.requestContext.authorizer.lambda['custom:tenantId'] (Lambda authorizer)
 *
 * If a tenantId is present in the request path parameters or body, validates
 * it matches the JWT tenantId. A mismatch returns HTTP 403.
 *
 * Platform Admin/Support roles (resolved by the RBAC middleware) are allowed
 * to bypass tenant isolation for cross-tenant operations.
 *
 * On success: attaches `TenantContext` to `event.requestContext.authorizer.tenantContext`
 * On failure: short-circuits with HTTP 401 (missing tenant) or 403 (mismatch)
 */
export function tenantContextMiddleware(): middy.MiddlewareObj {
  const before: middy.MiddlewareFn = async (request) => {
    const event = request.event as Record<string, unknown>;

    const requestContext = event['requestContext'] as
      | Record<string, unknown>
      | undefined;
    const authorizer = requestContext?.['authorizer'] as
      | Record<string, unknown>
      | undefined;

    // Check if RBAC has already resolved the role (Admin/Support bypass)
    const rbac = authorizer?.['rbac'] as
      | Record<string, unknown>
      | undefined;
    const resolvedRole = rbac?.['role'] as string | undefined;

    // Extract tenantId from JWT claims (support both authorizer patterns)
    const tenantId = extractTenantId(authorizer);

    // Platform Admin/Support can bypass tenant isolation
    if (resolvedRole && BYPASS_ROLES.has(resolvedRole)) {
      logger.info('Tenant context bypass — platform role', {
        role: resolvedRole,
        tenantId: tenantId ?? 'none',
      });

      // Still attach tenant context if available (useful for audit logging)
      const context: TenantContext = { tenantId: tenantId ?? 'platform' };
      attachTenantContext(event, requestContext, authorizer, context);
      return;
    }

    // tenantId is required for non-platform roles
    if (!tenantId) {
      logger.warn('Missing tenantId in JWT claims');

      const response = {
        statusCode: 401,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          error: { code: 'MISSING_TENANT', message: 'Tenant context required' },
        }),
      };

      request.response = response as unknown as typeof request.response;
      return response;
    }

    // Validate tenant isolation — check path params and body for tenantId
    const requestTenantId = extractRequestTenantId(event);
    if (requestTenantId && requestTenantId !== tenantId) {
      logger.warn('Cross-tenant access attempt', {
        jwtTenantId: tenantId,
        requestTenantId,
      });

      const response = {
        statusCode: 403,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          error: { code: 'TENANT_MISMATCH', message: 'Cross-tenant access denied' },
        }),
      };

      request.response = response as unknown as typeof request.response;
      return response;
    }

    // Attach tenant context for downstream handlers
    const context: TenantContext = { tenantId };
    attachTenantContext(event, requestContext, authorizer, context);

    logger.info('Tenant context attached', { tenantId });

    return;
  };

  return { before };
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Extract tenantId from the authorizer context.
 * Supports both JWT authorizer (jwt.claims) and Lambda authorizer (lambda) patterns.
 */
function extractTenantId(authorizer: Record<string, unknown> | undefined): string | undefined {
  if (!authorizer) {
    return undefined;
  }

  // Pattern 1: JWT authorizer — event.requestContext.authorizer.jwt.claims
  const jwt = authorizer['jwt'] as Record<string, unknown> | undefined;
  if (jwt) {
    const claims = jwt['claims'] as Record<string, unknown> | undefined;
    const tenantId = claims?.['custom:tenantId'] as string | undefined;
    if (tenantId) {
      return tenantId;
    }
  }

  // Pattern 2: Lambda authorizer — event.requestContext.authorizer.lambda
  const lambda = authorizer['lambda'] as Record<string, unknown> | undefined;
  if (lambda) {
    const tenantId = lambda['custom:tenantId'] as string | undefined;
    if (tenantId) {
      return tenantId;
    }
  }

  return undefined;
}

/**
 * Extract tenantId from the request path parameters or body.
 * Returns the tenantId if found in either location, or undefined.
 */
function extractRequestTenantId(event: Record<string, unknown>): string | undefined {
  // Check path parameters
  const pathParameters = event['pathParameters'] as Record<string, unknown> | undefined;
  if (pathParameters?.['tenantId']) {
    return pathParameters['tenantId'] as string;
  }

  // Check body (if parsed as object)
  let body = event['body'] as unknown;
  if (typeof body === 'string') {
    try {
      body = JSON.parse(body);
    } catch {
      // Body is not JSON, skip
      return undefined;
    }
  }

  if (body && typeof body === 'object') {
    const tenantId = (body as Record<string, unknown>)['tenantId'] as string | undefined;
    if (tenantId) {
      return tenantId;
    }
  }

  return undefined;
}

/**
 * Attach TenantContext to event.requestContext.authorizer.tenantContext
 */
function attachTenantContext(
  event: Record<string, unknown>,
  requestContext: Record<string, unknown> | undefined,
  authorizer: Record<string, unknown> | undefined,
  context: TenantContext,
): void {
  if (!requestContext) {
    (event as Record<string, unknown>)['requestContext'] = {
      authorizer: { tenantContext: context },
    };
  } else if (!authorizer) {
    (requestContext as Record<string, unknown>)['authorizer'] = { tenantContext: context };
  } else {
    (authorizer as Record<string, unknown>)['tenantContext'] = context;
  }
}
