/**
 * Get Trial Usage Lambda handler — GET /entitlements/trial
 *
 * Returns the seller's free-trial usage for the UI ("3 of 15 free products
 * used"). Read-only: it never starts a trial (that happens with the first
 * product created). Tenant comes from the authorizer, never from the request.
 */
import type { APIGatewayProxyEventV2, APIGatewayProxyResultV2 } from 'aws-lambda';
import { extractTenantContext } from '../../../shared/middleware/tenant-context';
import { getTrialUsage } from '../../../shared/entitlements/trial-gate';
import { mapErrorToResponse } from '../error-mapper';

export async function handler(event: APIGatewayProxyEventV2): Promise<APIGatewayProxyResultV2> {
  const tenantContext = extractTenantContext(event as unknown as Record<string, unknown>);
  if (!tenantContext) {
    return {
      statusCode: 401,
      body: JSON.stringify({ error: { code: 'UNAUTHORIZED', message: 'Missing tenant context' } }),
    };
  }

  try {
    const usage = await getTrialUsage(tenantContext.tenantId);
    return {
      statusCode: 200,
      headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' },
      body: JSON.stringify(usage),
    };
  } catch (error) {
    return mapErrorToResponse(error);
  }
}
