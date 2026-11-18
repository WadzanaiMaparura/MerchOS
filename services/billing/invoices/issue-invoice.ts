/**
 * Issues the invoice DOCUMENT for a paid invoice record: assigns its sequential
 * number, renders the PDF, stores it in S3 and records where it is.
 *
 * Every step is idempotent, so this can be called from the payment webhook (best
 * effort) AND again from the download endpoint if the webhook attempt failed:
 *   - the number is assigned at most once (see invoice-number.ts)
 *   - the buyer details are snapshotted on first issue and reused afterwards
 *   - once `pdfKey` is recorded the PDF is never regenerated
 */
import { BILLING_TABLE, createTenantDynamoClient, invoiceSK, tenantPK } from '../../shared/utils/dynamo-client';
import { getPlan } from '../config/plans';
import { loadInvoiceIssuer } from '../config/invoice-issuer';
import { getBillingProfile } from '../services/billing-profile';
import { assignInvoiceNumber } from './invoice-number';
import { renderInvoicePdf, type InvoiceBuyer, type InvoiceDocumentData } from './invoice-pdf';
import { invoicePdfKey, putInvoicePdf } from './invoice-storage';

export class InvoiceNotFoundError extends Error {
  readonly code = 'INVOICE_NOT_FOUND';
  readonly status = 404;
  constructor() {
    super('Invoice not found');
    this.name = 'InvoiceNotFoundError';
  }
}

export interface IssuedInvoice {
  invoiceNumber: string;
  pdfKey: string;
}

interface InvoiceItem {
  invoiceId: string;
  planId: string;
  status: string;
  amountDue: number;
  listPriceCents?: number;
  discountCents?: number;
  voucherCode?: string;
  payerName?: string;
  payerEmail?: string;
  periodStart?: string;
  periodEnd?: string;
  createdAt: string;
  providerRef?: string;
  invoiceNumber?: string;
  pdfKey?: string;
  buyerSnapshot?: InvoiceBuyer;
}

async function loadInvoice(tenantId: string, invoiceId: string): Promise<InvoiceItem | null> {
  const client = createTenantDynamoClient(tenantId);
  const res = await client.get({
    TableName: BILLING_TABLE,
    Key: { PK: tenantPK(tenantId), SK: invoiceSK(invoiceId) },
    ConsistentRead: true,
  });
  return res.Item ? (res.Item as unknown as InvoiceItem) : null;
}

async function resolveBuyer(tenantId: string, invoice: InvoiceItem): Promise<InvoiceBuyer> {
  const profile = await getBillingProfile(tenantId);
  if (profile?.companyName) {
    return {
      name: profile.companyName,
      email: profile.email ?? invoice.payerEmail,
      registrationNumber: profile.registrationNumber,
      vatNumber: profile.vatNumber,
      addressLines: profile.addressLines,
    };
  }
  return {
    name: invoice.payerName || invoice.payerEmail || 'MerchOS customer',
    email: invoice.payerEmail,
  };
}

export async function issueInvoiceDocument(
  tenantId: string,
  invoiceId: string
): Promise<IssuedInvoice> {
  const invoice = await loadInvoice(tenantId, invoiceId);
  if (!invoice || invoice.status !== 'paid') throw new InvoiceNotFoundError();

  const invoiceNumber = await assignInvoiceNumber(tenantId, invoiceId);
  if (invoice.pdfKey) return { invoiceNumber, pdfKey: invoice.pdfKey };

  const buyer = invoice.buyerSnapshot ?? (await resolveBuyer(tenantId, invoice));
  const plan = getPlan(invoice.planId as Parameters<typeof getPlan>[0]);
  const discount = invoice.discountCents ?? 0;
  const listPrice = invoice.listPriceCents ?? invoice.amountDue + discount;

  const data: InvoiceDocumentData = {
    invoiceNumber,
    issuedAt: invoice.createdAt,
    issuer: loadInvoiceIssuer(),
    buyer,
    lines: [
      {
        description: `${plan.name} plan - monthly subscription`,
        quantity: 1,
        unitCents: listPrice,
        totalCents: listPrice,
      },
    ],
    ...(discount > 0 && invoice.voucherCode
      ? { discount: { code: invoice.voucherCode, cents: discount } }
      : {}),
    totalCents: invoice.amountDue,
    currency: 'ZAR',
    paymentReference: invoice.providerRef ?? invoice.invoiceId,
    paymentMethod: 'PayFast',
    periodStart: invoice.periodStart,
    periodEnd: invoice.periodEnd,
  };

  const pdf = await renderInvoicePdf(data);
  const pdfKey = invoicePdfKey(tenantId, invoiceNumber);
  await putInvoicePdf(pdfKey, pdf);

  // Record the document. Conditional on no key yet, so a concurrent issuer that
  // finished first keeps its record (both wrote the same key, same content).
  const client = createTenantDynamoClient(tenantId);
  try {
    await client.update({
      TableName: BILLING_TABLE,
      Key: { PK: tenantPK(tenantId), SK: invoiceSK(invoiceId) },
      UpdateExpression: 'SET #k = :key, #b = :buyer',
      ConditionExpression: 'attribute_not_exists(#k)',
      ExpressionAttributeNames: { '#k': 'pdfKey', '#b': 'buyerSnapshot' },
      ExpressionAttributeValues: { ':key': pdfKey, ':buyer': stripUndefined(buyer) },
    });
  } catch (error) {
    if ((error as { name?: string }).name !== 'ConditionalCheckFailedException') throw error;
  }
  return { invoiceNumber, pdfKey };
}

function stripUndefined<T extends object>(value: T): T {
  return Object.fromEntries(Object.entries(value).filter(([, v]) => v !== undefined)) as T;
}
