/**
 * GET /billing/invoices/{invoiceId}/pdf
 *
 * Returns a short-lived presigned URL for the invoice PDF, issuing the document
 * first if the payment webhook did not manage to (number + PDF are idempotent).
 *
 * RBAC: subscription:read. tenantId comes only from the trusted JWT, and the
 * invoice is read through the tenant-scoped client, so a seller can only ever
 * reach their own invoices; an unknown or foreign id is just a 404.
 */
import middy from '@middy/core';
import type { APIGatewayProxyEventV2, APIGatewayProxyResultV2 } from 'aws-lambda';
import { rbacMiddleware } from '../../../shared/middleware/rbac';
import {
  tenantContextMiddleware,
  extractTenantContext,
} from '../../../shared/middleware/tenant-context';
import { logger } from '../../../shared/middleware/logger';
import { InvoiceNotFoundError, issueInvoiceDocument } from '../../invoices/issue-invoice';
import { PRESIGN_SECONDS, presignInvoiceDownload } from '../../invoices/invoice-storage';
import { mapErrorToResponse, ApiErrors } from '../error-mapper';

/** Invoice ids are PayFast m_payment_ids (UUIDs); keep the check generic but tight. */
const INVOICE_ID_PATTERN = /^[A-Za-z0-9-]{1,100}$/;

async function baseHandler(event: APIGatewayProxyEventV2): Promise<APIGatewayProxyResultV2> {
  const tenantContext = extractTenantContext(event as unknown as Record<string, unknown>);
  if (!tenantContext) {
    return ApiErrors.unauthorized() as APIGatewayProxyResultV2;
  }

  const invoiceId = event.pathParameters?.['invoiceId'];
  if (!invoiceId || !INVOICE_ID_PATTERN.test(invoiceId)) {
    return ApiErrors.validation('Invalid invoice id', 'invoiceId') as APIGatewayProxyResultV2;
  }

  try {
    const { invoiceNumber, pdfKey } = await issueInvoiceDocument(tenantContext.tenantId, invoiceId);
    const url = await presignInvoiceDownload(pdfKey, invoiceNumber);
    return {
      statusCode: 200,
      headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' },
      body: JSON.stringify({ url, invoiceNumber, expiresInSeconds: PRESIGN_SECONDS }),
    };
  } catch (error) {
    // A plain "not found" is a normal outcome (stale link, mistyped id), not a
    // fault: do not log it as an error, or it would trip the invoice-failure alarm.
    if (error instanceof InvoiceNotFoundError) {
      return mapErrorToResponse(error) as APIGatewayProxyResultV2;
    }
    logger.error('Get invoice PDF failed', {
      error: error instanceof Error ? error.message : String(error),
    });
    return mapErrorToResponse(error) as APIGatewayProxyResultV2;
  }
}

export const handler = middy(baseHandler)
  .use(rbacMiddleware({ resource: 'subscription', action: 'read' }))
  .use(tenantContextMiddleware());
