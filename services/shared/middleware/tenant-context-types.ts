/**
 * TenantContext types and extraction utility.
 *
 * This file has NO dependencies on middy, powertools, or AWS SDKs.
 * It can be safely imported by any service without transitive dependency issues.
 *
 * The tenantContextMiddleware (in tenant-context.ts) uses these types and
 * attaches TenantContext to the event. Downstream handlers use
 * extractTenantContext() to read the resolved context.
 *
 * ─── AUTHENTICATION MODEL ─────────────────────────────────────────────────
 *
 * MerchOS uses: API Gateway HTTP API + Cognito JWT authorizer
 *
 * Cognito → API Gateway HTTP API → JWT authorizer validates token
 *   → validated claims available in event.requestContext.authorizer.jwt.claims
 *   → tenantContextMiddleware resolves TenantContext
 *   → handlers read via extractTenantContext()
 *
 * Authoritative tenant claim: custom:tenantId
 * Authenticated user claim: sub
 *
 * ─── SECURITY RULES ──────────────────────────────────────────────────────
 *
 * - tenantId NEVER comes from request body, query, path, or custom headers
 * - Missing custom:tenantId → null (handler returns 401)
 * - No fake/default/platform tenant is ever invented
 * - ProductService receives only the trusted tenantId string
 */

export interface TenantContext {
  /** Tenant identity from Cognito custom:tenantId claim */
  tenantId: string;
  /** User identity from Cognito sub claim */
  userId?: string;
}

/**
 * Reads the TenantContext resolved by the tenantContextMiddleware.
 *
 * Reads ONLY from event.requestContext.authorizer.tenantContext —
 * the output of the shared tenantContextMiddleware.
 *
 * Returns null if no tenant context has been resolved (handler should return 401).
 *
 * Does NOT independently resolve from JWT/Lambda claims.
 * Does NOT read from request body/query/path.
 * Does NOT invent a fake/default tenant.
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
