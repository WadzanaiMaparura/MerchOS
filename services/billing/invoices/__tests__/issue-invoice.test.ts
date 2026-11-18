import { describe, it, expect, vi, beforeEach } from 'vitest';

const tenantGet = vi.fn();
const tenantUpdate = vi.fn();
vi.mock('../../../shared/utils/dynamo-client', async (orig) => ({
  ...(await orig<typeof import('../../../shared/utils/dynamo-client')>()),
  createTenantDynamoClient: () => ({ get: tenantGet, update: tenantUpdate }),
}));
vi.mock('../invoice-number', () => ({ assignInvoiceNumber: vi.fn() }));
vi.mock('../invoice-storage', async (orig) => ({
  ...(await orig<typeof import('../invoice-storage')>()),
  putInvoicePdf: vi.fn(),
}));
vi.mock('../../services/billing-profile', () => ({ getBillingProfile: vi.fn() }));

import { issueInvoiceDocument, InvoiceNotFoundError } from '../issue-invoice';
import { assignInvoiceNumber } from '../invoice-number';
import { putInvoicePdf } from '../invoice-storage';
import { getBillingProfile } from '../../services/billing-profile';

const paid = {
  invoiceId: 'i1',
  planId: 'starter',
  status: 'paid',
  amountDue: 500,
  listPriceCents: 49900,
  discountCents: 49400,
  voucherCode: 'LIVE-TEST-R5',
  payerName: 'Jane Payer',
  payerEmail: 'jane@example.com',
  periodStart: '2026-11-17T15:44:47.228Z',
  periodEnd: '2026-12-17T15:44:47.228Z',
  createdAt: '2026-11-17T15:44:47.228Z',
  providerRef: 'pay-1',
};

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(assignInvoiceNumber).mockResolvedValue('MOS-000042');
  vi.mocked(getBillingProfile).mockResolvedValue(null);
  tenantGet.mockResolvedValue({ Item: paid });
});

describe('issueInvoiceDocument', () => {
  it('numbers the invoice, renders + stores the PDF under invoices/<tenant>/<number>.pdf and records it', async () => {
    const r = await issueInvoiceDocument('t1', 'i1');
    expect(r).toEqual({ invoiceNumber: 'MOS-000042', pdfKey: 'invoices/t1/MOS-000042.pdf' });
    const [key, bytes] = vi.mocked(putInvoicePdf).mock.calls[0]!;
    expect(key).toBe('invoices/t1/MOS-000042.pdf');
    expect(Buffer.from(bytes.slice(0, 5)).toString()).toBe('%PDF-');
    const upd = tenantUpdate.mock.calls[0]![0];
    expect(upd.ExpressionAttributeValues[':key']).toBe('invoices/t1/MOS-000042.pdf');
    expect(upd.ConditionExpression).toBe('attribute_not_exists(#k)');
  });

  it('uses the payer reported by PayFast as buyer when there is no billing profile', async () => {
    await issueInvoiceDocument('t1', 'i1');
    expect(tenantUpdate.mock.calls[0]![0].ExpressionAttributeValues[':buyer']).toEqual({
      name: 'Jane Payer',
      email: 'jane@example.com',
    });
  });

  it('prefers the seller billing profile and snapshots it on the invoice', async () => {
    vi.mocked(getBillingProfile).mockResolvedValue({
      companyName: 'Acme (Pty) Ltd',
      vatNumber: '4123456789',
      addressLines: ['1 Main St'],
      updatedAt: 'x',
    });
    await issueInvoiceDocument('t1', 'i1');
    expect(tenantUpdate.mock.calls[0]![0].ExpressionAttributeValues[':buyer']).toMatchObject({
      name: 'Acme (Pty) Ltd',
      vatNumber: '4123456789',
      email: 'jane@example.com',
    });
  });

  it('reuses the stored snapshot instead of re-reading the (possibly edited) profile', async () => {
    tenantGet.mockResolvedValue({ Item: { ...paid, buyerSnapshot: { name: 'Old Name' } } });
    await issueInvoiceDocument('t1', 'i1');
    expect(getBillingProfile).not.toHaveBeenCalled();
  });

  it('does not regenerate or re-upload when the PDF already exists', async () => {
    tenantGet.mockResolvedValue({ Item: { ...paid, invoiceNumber: 'MOS-000042', pdfKey: 'invoices/t1/MOS-000042.pdf' } });
    const r = await issueInvoiceDocument('t1', 'i1');
    expect(r.pdfKey).toBe('invoices/t1/MOS-000042.pdf');
    expect(putInvoicePdf).not.toHaveBeenCalled();
    expect(tenantUpdate).not.toHaveBeenCalled();
  });

  it('treats a concurrent issuer finishing first as success (same key, same content)', async () => {
    tenantUpdate.mockRejectedValue(Object.assign(new Error('c'), { name: 'ConditionalCheckFailedException' }));
    await expect(issueInvoiceDocument('t1', 'i1')).resolves.toMatchObject({ invoiceNumber: 'MOS-000042' });
  });

  it('propagates unexpected storage errors so the caller can retry', async () => {
    vi.mocked(putInvoicePdf).mockRejectedValue(new Error('s3 down'));
    await expect(issueInvoiceDocument('t1', 'i1')).rejects.toThrow('s3 down');
    expect(tenantUpdate).not.toHaveBeenCalled(); // never records a PDF that was not stored
  });

  it.each([
    ['unknown invoice', undefined],
    ['unpaid invoice', { ...paid, status: 'open' }],
  ])('refuses %s with InvoiceNotFoundError and assigns no number', async (_n, item) => {
    tenantGet.mockResolvedValue({ Item: item });
    await expect(issueInvoiceDocument('t1', 'i1')).rejects.toBeInstanceOf(InvoiceNotFoundError);
    expect(assignInvoiceNumber).not.toHaveBeenCalled();
  });
});
