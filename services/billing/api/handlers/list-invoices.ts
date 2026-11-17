/**
 * List Invoices Lambda handler — GET /billing/invoices
 *
 * Returns the authenticated tenant's invoices, newest first, as a
 * `PaginatedResponse<InvoiceSummary>` (@merch-os/types) — the contract the
 * seller-dashboard `useInvoices` hook and billing-page invoice table consume
 * (`?page=&pageSize=`).
 *
 * A tenant has at most one invoice per payment (a handful per year), so we read
 * the tenant's invoice partition (bounded by MAX_INVOICES) and page in memory
 * rather than juggling DynamoDB cursors across page numbers.
 *
 * RBAC: subscription:read. tenantId comes only from the trusted JWT.
 */

import middy from '@middy/core';
import type { APIGatewayProxyEventV2, APIGatewayProxyResultV2 } from 'aws-lambda';
import type { InvoiceSummary, InvoiceStatus, PaginatedResponse } from '@merch-os/types';

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

/** Safety bound on invoices read per request. */
const MAX_INVOICES = 500;
const DEFAULT_PAGE_SIZE = 20;

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

async function loadInvoices(tenantId: string): Promise<Record<string, unknown>[]> {
  const client = createTenantDynamoClient(tenantId);
  const items: Record<string, unknown>[] = [];
  let startKey: Record<string, unknown> | undefined;
  do {
    const res = await client.query({
      TableName: BILLING_TABLE,
      KeyConditionExpression: 'PK = :pk AND begins_with(SK, :sk)',
      ExpressionAttributeValues: {
        ':pk': tenantPK(tenantId),
        ':sk': 'INVOICE#',
      },
      ...(startKey ? { ExclusiveStartKey: startKey } : {}),
    });
    items.push(...((res.Items ?? []) as Record<string, unknown>[]));
    startKey = res.LastEvaluatedKey as Record<string, unknown> | undefined;
  } while (startKey && items.length < MAX_INVOICES);
  return items;
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

  const page = parsed.data.page ?? 1;
  const pageSize = parsed.data.pageSize ?? DEFAULT_PAGE_SIZE;

  try {
    const all = await loadInvoices(tenantContext.tenantId);
    // Newest first. Invoice ids are payment ids (uuids), so sort on createdAt.
    all.sort((a, b) => String(b['createdAt'] ?? '').localeCompare(String(a['createdAt'] ?? '')));

    const start = (page - 1) * pageSize;
    const slice = all.slice(start, start + pageSize);

    const body: PaginatedResponse<InvoiceSummary> = {
      items: slice.map(toSummary),
      total: all.length,
      page,
      pageSize,
      hasMore: start + slice.length < all.length,
    };

    return {
      statusCode: 200,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
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
