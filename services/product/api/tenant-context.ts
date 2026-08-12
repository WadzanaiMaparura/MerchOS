/**
 * Extracts the trusted tenant context from the API Gateway event.
 *
 * The tenantId comes from the authenticated JWT claims (set by tenantContextMiddleware),
 * NOT from client-supplied request data.
 *
 * Future: Cognito authorizer will populate this automatically.
 * Current: Extracted from event.requestContext.authorizer.tenantContext
 */
export interface TenantContext {
  tenantId: string;
  userId?: string;
}

export function extractTenantContext(event: Record<string, unknown>): TenantContext | null {
  const requestContext = event['requestContext'] as Record<string, unknown> | undefined;
  const authorizer = requestContext?.['authorizer'] as Record<string, unknown> | undefined;
  const tenantCtx = authorizer?.['tenantContext'] as Record<string, unknown> | undefined;
  const tenantId = tenantCtx?.['tenantId'] as string | undefined;

  if (!tenantId) return null;

  return {
    tenantId,
    userId: tenantCtx?.['userId'] as string | undefined,
  };
}
