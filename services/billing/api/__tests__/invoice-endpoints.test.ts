import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../../invoices/issue-invoice', async (orig) => ({
  ...(await orig<typeof import('../../invoices/issue-invoice')>()),
  issueInvoiceDocument: vi.fn(),
}));
vi.mock('../../invoices/invoice-storage', async (orig) => ({
  ...(await orig<typeof import('../../invoices/invoice-storage')>()),
  presignInvoiceDownload: vi.fn(),
}));
vi.mock('../../services/billing-profile', () => ({
  getBillingProfile: vi.fn(),
  putBillingProfile: vi.fn(),
}));
vi.mock('../../../shared/middleware/logger', () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn(), addContext: vi.fn() },
}));

import { handler as pdfHandler } from '../handlers/get-invoice-pdf';
import { handler as getProfile } from '../handlers/get-billing-profile';
import { handler as putProfile } from '../handlers/put-billing-profile';
import { issueInvoiceDocument, InvoiceNotFoundError } from '../../invoices/issue-invoice';
import { presignInvoiceDownload } from '../../invoices/invoice-storage';
import { getBillingProfile, putBillingProfile } from '../../services/billing-profile';
import { logger } from '../../../shared/middleware/logger';

const ISS = 'https://cognito-idp.eu-west-1.amazonaws.com/eu-west-1_test';
process.env['COGNITO_ISSUER'] = ISS;

function event(opts: { body?: unknown; pathParameters?: Record<string, string>; groups?: string[]; tenant?: string | null } = {}) {
  const claims: Record<string, unknown> = {
    sub: 'u-1',
    iss: ISS,
    exp: Math.floor(Date.now() / 1000) + 600,
    'cognito:groups': opts.groups ?? ['Seller'],
    token_use: 'access',
  };
  if (opts.tenant !== null) claims['custom:tenantId'] = opts.tenant ?? 'tenant-1';
  return {
    version: '2.0',
    headers: {},
    pathParameters: opts.pathParameters,
    requestContext: { http: { method: 'GET', sourceIp: '1.1.1.1' }, authorizer: { jwt: { claims } } },
    body: opts.body === undefined ? undefined : JSON.stringify(opts.body),
    isBase64Encoded: false,
  } as never;
}
type Fn = (e: unknown, c: unknown) => Promise<{ statusCode: number; body: string; headers?: Record<string, string> }>;
const call = async (h: unknown, e: unknown) => {
  const r = await (h as Fn)(e, {});
  return { status: r.statusCode, json: JSON.parse(r.body || '{}'), headers: r.headers ?? {} };
};

beforeEach(() => vi.clearAllMocks());

describe('GET /billing/invoices/{invoiceId}/pdf', () => {
  it('issues (idempotently) then returns a presigned URL, scoped to the JWT tenant', async () => {
    vi.mocked(issueInvoiceDocument).mockResolvedValue({ invoiceNumber: 'MOS-000042', pdfKey: 'invoices/tenant-1/MOS-000042.pdf' });
    vi.mocked(presignInvoiceDownload).mockResolvedValue('https://s3.example/signed');
    const { status, json, headers } = await call(pdfHandler, event({ pathParameters: { invoiceId: 'abc-123' } }));
    expect(status).toBe(200);
    expect(json).toEqual({ url: 'https://s3.example/signed', invoiceNumber: 'MOS-000042', expiresInSeconds: 300 });
    expect(headers['Cache-Control']).toBe('no-store');
    expect(issueInvoiceDocument).toHaveBeenCalledWith('tenant-1', 'abc-123');
    expect(presignInvoiceDownload).toHaveBeenCalledWith('invoices/tenant-1/MOS-000042.pdf', 'MOS-000042');
  });

  it.each(['../etc/passwd', 'a/b', 'a b', '', 'x'.repeat(101)])('rejects a malformed invoice id (%j) before any lookup', async (id) => {
    const { status, json } = await call(pdfHandler, event({ pathParameters: { invoiceId: id } }));
    expect(status).toBe(400);
    expect(json.error.field).toBe('invoiceId');
    expect(issueInvoiceDocument).not.toHaveBeenCalled();
  });

  it('answers 404 (not 403/500) for an invoice that is not this tenant’s, leaking nothing', async () => {
    vi.mocked(issueInvoiceDocument).mockRejectedValue(new InvoiceNotFoundError());
    const { status, json } = await call(pdfHandler, event({ pathParameters: { invoiceId: 'someone-elses' } }));
    expect(status).toBe(404);
    expect(json.error.code).toBe('INVOICE_NOT_FOUND');
    expect(presignInvoiceDownload).not.toHaveBeenCalled();
    // A normal 404 must not log at error level (that would trip the failure alarm).
    expect(logger.error).not.toHaveBeenCalled();
  });

  it('logs a real failure at error level (this is what the alarm watches)', async () => {
    vi.mocked(issueInvoiceDocument).mockRejectedValue(new Error('s3 down'));
    await call(pdfHandler, event({ pathParameters: { invoiceId: 'abc' } }));
    expect(logger.error).toHaveBeenCalledWith('Get invoice PDF failed', expect.any(Object));
  });

  it('collapses unexpected errors to a generic 500 with no detail', async () => {
    vi.mocked(issueInvoiceDocument).mockRejectedValue(new Error('s3 bucket arn:aws:... secret detail'));
    const { status, json } = await call(pdfHandler, event({ pathParameters: { invoiceId: 'abc' } }));
    expect(status).toBe(500);
    expect(JSON.stringify(json)).not.toContain('secret detail');
  });

  it('is denied without a tenant claim', async () => {
    const { status } = await call(pdfHandler, event({ pathParameters: { invoiceId: 'abc' }, tenant: null }));
    expect([401, 403]).toContain(status);
    expect(issueInvoiceDocument).not.toHaveBeenCalled();
  });
});

describe('GET /billing/profile', () => {
  it('returns the profile for the JWT tenant, or null', async () => {
    vi.mocked(getBillingProfile).mockResolvedValue(null);
    expect((await call(getProfile, event())).json).toEqual({ profile: null });
    expect(getBillingProfile).toHaveBeenCalledWith('tenant-1');
  });
});

describe('PUT /billing/profile', () => {
  const ok = { companyName: 'Acme (Pty) Ltd', vatNumber: '4123456789', email: 'ap@acme.example', addressLines: ['1 Main St', 'Sandton'] };

  it('saves a valid profile for the JWT tenant', async () => {
    vi.mocked(putBillingProfile).mockResolvedValue({ ...ok, updatedAt: 'now' });
    const { status, json } = await call(putProfile, event({ body: ok }));
    expect(status).toBe(200);
    expect(json.profile.companyName).toBe('Acme (Pty) Ltd');
    expect(putBillingProfile).toHaveBeenCalledWith('tenant-1', ok);
  });

  it('accepts just a company name', async () => {
    vi.mocked(putBillingProfile).mockResolvedValue({ companyName: 'Solo', updatedAt: 'now' });
    expect((await call(putProfile, event({ body: { companyName: 'Solo' } }))).status).toBe(200);
  });

  it.each([
    ['missing company name', {}],
    ['blank company name', { companyName: '   ' }],
    ['company name too long', { companyName: 'x'.repeat(121) }],
    ['bad VAT number', { companyName: 'A', vatNumber: '12 !' }],
    ['bad email', { companyName: 'A', email: 'nope' }],
    ['too many address lines', { companyName: 'A', addressLines: ['1', '2', '3', '4', '5', '6'] }],
    ['unknown field', { companyName: 'A', isAdmin: true }],
  ])('rejects %s with 400 and saves nothing', async (_n, body) => {
    const { status, json } = await call(putProfile, event({ body }));
    expect(status).toBe(400);
    expect(json.error.code).toBe('VALIDATION_ERROR');
    expect(putBillingProfile).not.toHaveBeenCalled();
  });

  it('refuses a body naming another tenant (platform tenant-isolation middleware) and saves nothing', async () => {
    const { status, json } = await call(putProfile, event({ body: { companyName: 'A', tenantId: 'other-tenant' } }));
    expect(status).toBe(403);
    expect(json.error.code).toBe('TENANT_MISMATCH');
    expect(putBillingProfile).not.toHaveBeenCalled();
  });

  it('rejects malformed JSON', async () => {
    const e = event();
    (e as { body: string }).body = '{nope';
    expect((await call(putProfile, e)).status).toBe(400);
  });
});
