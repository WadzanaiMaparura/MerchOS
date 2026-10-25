/**
 * Extracts the authenticated tenantId from the request context attached by the
 * shared tenantContextMiddleware. Returns undefined when absent (the handler
 * then responds 401), never trusting client-supplied tenant values.
 */
export function extractTenantId(event: Record<string, unknown>): string | undefined {
  const requestContext = event['requestContext'] as Record<string, unknown> | undefined;
  const authorizer = requestContext?.['authorizer'] as Record<string, unknown> | undefined;
  const tenantContext = authorizer?.['tenantContext'] as Record<string, unknown> | undefined;
  const tenantId = tenantContext?.['tenantId'];
  return typeof tenantId === 'string' ? tenantId : undefined;
}
