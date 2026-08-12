/**
 * Extracts the trusted tenant context from an authenticated API Gateway event.
 *
 * Reads the tenant identity from the Cognito JWT claim `custom:tenantId` as
 * validated by API Gateway's Cognito/JWT authorizer. The user identity comes
 * from the `sub` claim.
 *
 * Supported authorizer patterns:
 * 1. Shared tenantContextMiddleware output:
 *    event.requestContext.authorizer.tenantContext.tenantId
 * 2. API Gateway JWT authorizer:
 *    event.requestContext.authorizer.jwt.claims['custom:tenantId']
 * 3. Lambda authorizer:
 *    event.requestContext.authorizer.lambda['custom:tenantId']
 *
 * The tenantId NEVER comes from client-supplied request data (body, query, path).
 * Missing tenant claim → return null (handler returns 401).
 *
 * @see docs/architecture/merchos-blueprint.md §1 (Authentication Architecture)
 */
export interface TenantContext {
  /** Tenant identity from Cognito custom:tenantId claim */
  tenantId: string;
  /** User identity from Cognito sub claim */
  userId?: string;
}

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
  // event.requestContext.authorizer.jwt.claims['custom:tenantId']
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
  // event.requestContext.authorizer.lambda['custom:tenantId']
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

  // No tenant claim found in any pattern
  return null;
}
