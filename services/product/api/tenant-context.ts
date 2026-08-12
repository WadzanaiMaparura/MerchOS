/**
 * TenantContext extraction for the Product API Lambda handlers.
 *
 * ─── AUTHORITATIVE CONTRACT ───────────────────────────────────────────────
 *
 * The canonical TenantContext contract is defined by the shared middleware:
 *   services/shared/middleware/tenant-context.ts
 *
 * This extraction utility implements the same contract for direct use in
 * Product API handlers without requiring the full middy middleware pipeline.
 * Both implementations read from the same authorizer context structure.
 *
 * ─── TRUST MODEL ──────────────────────────────────────────────────────────
 *
 * Authoritative tenant claim: custom:tenantId (Cognito custom attribute)
 * Authenticated user identity: sub (Cognito user UUID)
 *
 * The tenantId NEVER comes from client-supplied request data:
 * - NOT from request body
 * - NOT from query parameters
 * - NOT from path parameters
 * - NOT from custom HTTP headers
 *
 * API Gateway validates the JWT before invocation (Cognito user-pool authorizer).
 * This function consumes the pre-validated authorizer context.
 *
 * ─── PATTERNS SUPPORTED ──────────────────────────────────────────────────
 *
 * 1. Shared tenantContextMiddleware output:
 *    event.requestContext.authorizer.tenantContext.tenantId
 * 2. API Gateway JWT authorizer (Cognito):
 *    event.requestContext.authorizer.jwt.claims['custom:tenantId']
 * 3. Lambda authorizer:
 *    event.requestContext.authorizer.lambda['custom:tenantId']
 *
 * @see services/shared/middleware/tenant-context.ts — Shared middleware (middy)
 * @see docs/architecture/merchos-blueprint.md §1 — Authentication Architecture
 */
export interface TenantContext {
  /** Tenant identity from Cognito custom:tenantId claim */
  tenantId: string;
  /** User identity from Cognito sub claim */
  userId?: string;
}

/**
 * Extracts the trusted TenantContext from an API Gateway event.
 *
 * Returns null if no tenant claim is found (handler should return 401).
 */
export function extractTenantContext(event: Record<string, unknown>): TenantContext | null {
  const requestContext = event['requestContext'] as Record<string, unknown> | undefined;
  const authorizer = requestContext?.['authorizer'] as Record<string, unknown> | undefined;

  if (!authorizer) return null;

  // Pattern 1: tenantContextMiddleware already resolved context
  const tenantCtx = authorizer['tenantContext'] as Record<string, unknown> | undefined;
  if (tenantCtx?.['tenantId']) {
    return {
      tenantId: tenantCtx['tenantId'] as string,
      userId: tenantCtx['userId'] as string | undefined,
    };
  }

  // Pattern 2: API Gateway JWT authorizer (Cognito user pool)
  const jwt = authorizer['jwt'] as Record<string, unknown> | undefined;
  if (jwt) {
    const claims = jwt['claims'] as Record<string, unknown> | undefined;
    const tenantId = claims?.['custom:tenantId'] as string | undefined;
    if (tenantId) {
      return {
        tenantId,
        userId: claims?.['sub'] as string | undefined,
      };
    }
  }

  // Pattern 3: Lambda authorizer
  const lambda = authorizer['lambda'] as Record<string, unknown> | undefined;
  if (lambda) {
    const tenantId = lambda['custom:tenantId'] as string | undefined;
    if (tenantId) {
      return {
        tenantId,
        userId: lambda['sub'] as string | undefined,
      };
    }
  }

  // No tenant claim found — handler must return 401
  return null;
}
