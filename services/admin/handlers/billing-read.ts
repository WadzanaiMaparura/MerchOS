/**
 * Billing (read only). Admin dashboard JWT authorizer, then RBAC `billing` read
 * (Admin only). Nothing here moves money or changes a plan.
 *
 *   GET /admin/billing?q=&filter=paying|renewing|lapsed|problems|all
 *   GET /admin/billing/{tenantId}
 *   GET /admin/billing/{tenantId}/invoices/{invoiceId}/pdf   short-lived download link
 */

import middy from '@middy/core';
import type { APIGatewayProxyEventV2 } from 'aws-lambda';
import { GetCommand } from '@aws-sdk/lib-dynamodb';
import { presignInvoiceDownload } from '../../billing/invoices/invoice-storage';
import { rbacMiddleware } from '../../shared/middleware/rbac';
import {
  BILLING_FILTERS,
  loadBilling,
  matchesBillingFilter,
  matchesBillingSearch,
  type BillingFilter,
} from '../lib/billing';
import { config } from '../lib/config';
import { db, getEngagement, getMonthUsage } from '../lib/data';
import { UUID, badRequest, conflict, json, notFound, serverError, type HttpResult } from '../lib/http';

const INVOICE_ID = /^[A-Za-z0-9_-]{1,80}$/;

async function list(event: APIGatewayProxyEventV2): Promise<HttpResult> {
  const filter = (event.queryStringParameters?.['filter'] ?? 'paying') as BillingFilter;
  if (!BILLING_FILTERS.includes(filter)) return badRequest('Unknown filter');
  const q = (event.queryStringParameters?.['q'] ?? '').slice(0, 100);
  const now = new Date();
  const { rows, summary, invoicesBy } = await loadBilling(now);
  const searched = rows.filter((r) => matchesBillingSearch(r, q, invoicesBy.get(r.tenantId) ?? []));
  return json(200, {
    summary,
    customers: searched.filter((r) => matchesBillingFilter(r, filter, now)),
    counts: Object.fromEntries(BILLING_FILTERS.map((f) => [f, searched.filter((r) => matchesBillingFilter(r, f, now)).length])),
  });
}

async function detail(tenantId: string): Promise<HttpResult> {
  const { rows, invoicesBy, paymentsBy } = await loadBilling();
  const row = rows.find((r) => r.tenantId === tenantId);
  if (!row) return notFound('No subscription for this customer');
  const [monthUsage, engagement] = await Promise.all([getMonthUsage(tenantId), getEngagement(tenantId)]);
  return json(200, {
    customer: {
      ...row,
      monthUsage,
      freeMonthsOwed: engagement.freeMonthsOwed,
      invoices: invoicesBy.get(tenantId) ?? [],
      payments: paymentsBy.get(tenantId) ?? [],
    },
  });
}

async function invoicePdf(tenantId: string, invoiceId: string): Promise<HttpResult> {
  const res = await db().send(
    new GetCommand({ TableName: config.billingTable, Key: { PK: `TENANT#${tenantId}`, SK: `INVOICE#${invoiceId}` } }),
  );
  const item = res.Item;
  if (!item) return notFound('Invoice not found');
  const pdfKey = typeof item['pdfKey'] === 'string' ? item['pdfKey'] : undefined;
  const invoiceNumber = typeof item['invoiceNumber'] === 'string' ? item['invoiceNumber'] : undefined;
  // Admin never issues invoices (that assigns numbers): only existing PDFs.
  if (!pdfKey || !invoiceNumber) return conflict('The PDF for this invoice has not been issued yet.');
  return json(200, { url: await presignInvoiceDownload(pdfKey, invoiceNumber) });
}

async function baseHandler(event: APIGatewayProxyEventV2): Promise<HttpResult> {
  try {
    if (event.routeKey === 'GET /admin/billing') return await list(event);
    const tenantId = event.pathParameters?.['tenantId'];
    if (!tenantId || !UUID.test(tenantId)) return badRequest('Invalid customer id');
    switch (event.routeKey) {
      case 'GET /admin/billing/{tenantId}':
        return await detail(tenantId);
      case 'GET /admin/billing/{tenantId}/invoices/{invoiceId}/pdf': {
        const invoiceId = event.pathParameters?.['invoiceId'];
        if (!invoiceId || !INVOICE_ID.test(invoiceId)) return badRequest('Invalid invoice id');
        return await invoicePdf(tenantId, invoiceId);
      }
      default:
        return notFound();
    }
  } catch (err) {
    console.error('Billing read failed', { route: event.routeKey, error: (err as Error).message });
    return serverError();
  }
}

export const handler = middy(baseHandler).use(rbacMiddleware({ resource: 'billing', action: 'read' }));
