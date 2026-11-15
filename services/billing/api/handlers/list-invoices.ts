/**
 * List Invoices Lambda handler — GET /billing/invoices
 *
 * Returns the authenticated tenant's invoices (paginated), newest first, as
 * `InvoiceSummary[]` (@merch-os/types) for the billing page invoice table.
 *
 * RBAC: subscription:read. tenantId comes only from the trusted JWT.
 */

import middy from '@middy/core';
import type { APIGatewayProxyEventV2, APIGatewayProxyResultV2 } from 'aws-lambda';
import type { InvoiceSummary, InvoiceStatus } from '@merch-os/types';

import { rbacMiddleware } from '../../../shared/middleware/rbac';
import {
  tenantContextMiddleware,
  extractTenantContext,
} from '../../../shared/middleware/tenant-context';
import { logger } from '../../../shared/middleware/logger';
import {
  BILLING_TABLE,
  createTenantDynamoClient,
  tenantPK,
} from '../../../shared/utils/dynamo-client';
import { paginationQuerySchema } from '../schemas';
import { mapErrorToResponse, ApiErrors } from '../error-mapper';

/** Maps a stored invoice item to the frontend InvoiceSummary DTO. */
function toSummary(item: Record<string, unknown>): InvoiceSummary {
  const amountCents = typeof item['amountDue'] === 'number' ? (item['amountDue'] as number) : 0;
  return {
    invoiceId: String(item['invoiceId'] ?? ''),
    date: String(item['createdAt'] ?? ''),
    // InvoiceSummary.amount is in minor units (cents) — the billing page divides
    // by 100 when formatting, matching the stored integer-cents convention.
    amount: amountCents,
    currency: String(item['currency'] ?? 'ZAR'),
    status: (item['status'] as InvoiceStatus) ?? 'open',
    billingPeriodStart: String(item['periodStart'] ?? ''),
    billingPeriodEnd: String(item['periodEnd'] ?? ''),
    ...(item['pdfUrl'] ? { downloadUrl: String(item['pdfUrl']) } : {}),
  };
}

async function baseHandler(event: APIGatewayProxyEventV2): Promise<APIGatewayProxyResultV2> {
  const tenantContext = extractTenantContext(event as unknown as Record<string, unknown>);
  if (!tenantContext) {
    return ApiErrors.unauthorized() as APIGatewayProxyResultV2;
  }

  const parsed = paginationQuerySchema.safeParse(event.queryStringParameters ?? {});
  if (!parsed.success) {
    const first = parsed.error.errors[0];
    return ApiErrors.validation(
      first?.message ?? 'Invalid query parameters',
      first?.path.join('.')
    ) as APIGatewayProxyResultV2;
  }

  try {
    const client = createTenantDynamoClient(tenantContext.tenantId);
    const res = await client.query({
      TableName: BILLING_TABLE,
      KeyConditionExpression: 'PK = :pk AND begins_with(SK, :sk)',
      ExpressionAttributeValues: {
        ':pk': tenantPK(tenantContext.tenantId),
        ':sk': 'INVOICE#',
      },
      ScanIndexForward: false, // newest first (invoiceId/SK sorts descending)
      Limit: parsed.data.limit ?? 20,
      ...(parsed.data.nextToken
        ? { ExclusiveStartKey: JSON.parse(Buffer.from(parsed.data.nextToken, 'base64').toString('utf8')) }
        : {}),
    });

    const items = (res.Items ?? []).map(toSummary);
    const nextToken = res.LastEvaluatedKey
      ? Buffer.from(JSON.stringify(res.LastEvaluatedKey)).toString('base64')
      : undefined;

    return {
      statusCode: 200,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ items, ...(nextToken ? { nextToken } : {}) }),
    };
  } catch (error) {
    logger.error('List invoices failed', {
      error: error instanceof Error ? error.message : String(error),
    });
    return mapErrorToResponse(error) as APIGatewayProxyResultV2;
  }
}

export const handler = middy(baseHandler)
  .use(rbacMiddleware({ resource: 'subscription', action: 'read' }))
  .use(tenantContextMiddleware());
