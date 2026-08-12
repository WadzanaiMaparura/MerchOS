/**
 * Reads the trusted TenantContext resolved by the shared middleware.
 *
 * This does NOT resolve tenant identity from Cognito/JWT claims.
 * It only reads the ALREADY-RESOLVED context that the shared
 * tenantContextMiddleware (services/shared/middleware/tenant-context.ts)
 * attached to event.requestContext.authorizer.tenantContext.
 *
 * Authoritative source: shared tenantContextMiddleware
 * This file: reads the output; does NOT resolve or compete.
 */

export interface TenantContext {
  tenantId: string;
  userId?: string;
}

/**
 * Reads the TenantContext attached by the shared middleware.
 * Returns null if the middleware has not resolved a tenant (→ handler returns 401).
 */
export function extractTenantContext(event: Record<string, unknown>): TenantContext | null {
  const requestContext = event['requestContext'] as Record<string, unknown> | undefined;
  const authorizer = requestContext?.['authorizer'] as Record<string, unknown> | undefined;
  if (!authorizer) return null;

  const tenantCtx = authorizer['tenantContext'] as Record<string, unknown> | undefined;
  const tenantId = tenantCtx?.['tenantId'] as string | undefined;

  if (!tenantId) return null;

  return {
    tenantId,
    userId: tenantCtx?.['userId'] as string | undefined,
  };
}
