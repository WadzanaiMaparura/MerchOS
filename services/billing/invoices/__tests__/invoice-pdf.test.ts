import { describe, it, expect } from 'vitest';
import { inflateSync } from 'node:zlib';
import { PDFDocument } from 'pdf-lib';
import {
  renderInvoicePdf,
  formatMoney,
  formatLongDate,
  type InvoiceDocumentData,
} from '../invoice-pdf';
import { DEFAULT_ISSUER } from '../../config/invoice-issuer';

/**
 * Pulls the drawn text out of a pdf-lib document: inflates each content stream and
 * decodes the hex strings that standard fonts are written as ("<4D6572...> Tj").
 */
function pdfText(bytes: Uint8Array): string {
  const raw = Buffer.from(bytes).toString('latin1');
  const out: string[] = [];
  for (const stream of raw.matchAll(/stream\r?\n([\s\S]*?)\r?\nendstream/g)) {
    let content: string;
    try {
      content = inflateSync(Buffer.from(stream[1]!, 'latin1')).toString('latin1');
    } catch {
      continue; // not a Flate stream (fonts/metadata)
    }
    for (const m of content.matchAll(/<([0-9A-Fa-f]+)>\s*Tj/g)) {
      const hex = m[1]!;
      let t = '';
      for (let i = 0; i < hex.length; i += 2) t += String.fromCharCode(parseInt(hex.slice(i, i + 2), 16));
      out.push(t);
    }
  }
  return out.join('\n');
}

const base: InvoiceDocumentData = {
  invoiceNumber: 'MOS-000042',
  issuedAt: '2026-11-17T15:44:47.228Z',
  issuer: DEFAULT_ISSUER,
  buyer: { name: 'Acme Trading (Pty) Ltd', email: 'ap@acme.example' },
  lines: [{ description: 'Starter plan - monthly subscription', quantity: 1, unitCents: 49900, totalCents: 49900 }],
  totalCents: 49900,
  currency: 'ZAR',
  paymentReference: '5c5c9049-aad5-4960-86e6-a03b4587d843',
  paymentMethod: 'PayFast',
  periodStart: '2026-11-17T15:44:47.228Z',
  periodEnd: '2026-12-17T15:44:47.228Z',
};

describe('formatMoney / formatLongDate', () => {
  it.each([
    [0, 'R0.00'],
    [500, 'R5.00'],
    [49900, 'R499.00'],
    [199900, 'R1,999.00'],
    [123456789, 'R1,234,567.89'],
    [-49400, '-R494.00'],
  ])('%i cents -> %s', (cents, out) => expect(formatMoney(cents, 'ZAR')).toBe(out));
  it('uses the currency code for non-ZAR', () => expect(formatMoney(1050, 'USD')).toBe('USD 10.50'));
  it('formats dates in UTC', () => {
    expect(formatLongDate('2026-11-17T23:59:59.000Z')).toBe('17 November 2026');
    expect(formatLongDate('not a date')).toBe('not a date');
  });
});

describe('renderInvoicePdf', () => {
  it('produces a valid single-page A4 PDF', async () => {
    const bytes = await renderInvoicePdf(base);
    expect(Buffer.from(bytes.slice(0, 5)).toString()).toBe('%PDF-');
    const doc = await PDFDocument.load(bytes);
    expect(doc.getPageCount()).toBe(1);
    expect(doc.getTitle()).toBe('Invoice MOS-000042');
  });

  it('prints the legally required particulars', async () => {
    const t = pdfText(await renderInvoicePdf(base));
    expect(t).toContain('INVOICE');
    expect(t).toContain('No. MOS-000042');
    expect(t).toContain('Date: 17 November 2026');
    expect(t).toContain('MerchOS'); // supplier name
    expect(t).toContain('424 Pretorius Road'); // supplier address
    expect(t).toContain('Acme Trading (Pty) Ltd'); // buyer
    expect(t).toContain('Starter plan - monthly subscription'); // description
    expect(t).toContain('R499.00'); // amount
    expect(t).toContain('Payment reference: 5c5c9049-aad5-4960-86e6-a03b4587d843');
  });

  it('is NOT a tax invoice: no "Tax Invoice" title and no VAT amounts', async () => {
    const t = pdfText(await renderInvoicePdf(base));
    // The only mention of "tax invoice" is the disclaimer; the document title is plain INVOICE.
    expect(t).not.toMatch(/(^|\n)\s*(TAX|VAT) INVOICE/i);
    expect(t).not.toMatch(/VAT\s*(@|amount|\()/i);
    expect(t).toContain('not registered for VAT');
    expect(t).toContain('not a tax invoice');
  });

  it('shows the list price, the voucher discount and the amount actually due', async () => {
    const t = pdfText(
      await renderInvoicePdf({
        ...base,
        discount: { code: 'LIVE-TEST-R5', cents: 49400 },
        totalCents: 500,
      })
    );
    expect(t).toContain('R499.00');
    expect(t).toContain('Discount (voucher LIVE-TEST-R5)');
    expect(t).toContain('-R494.00');
    expect(t).toContain('Total due');
    expect(t).toContain('R5.00');
    expect(t).toContain('Balance due');
    expect(t).toContain('R0.00');
  });

  it("shows the buyer's registration and VAT numbers when they gave them", async () => {
    const t = pdfText(
      await renderInvoicePdf({
        ...base,
        buyer: { ...base.buyer, registrationNumber: '2019/123456/07', vatNumber: '4123456789', addressLines: ['1 Main St', 'Sandton'] },
      })
    );
    expect(t).toContain('Reg. no. 2019/123456/07');
    expect(t).toContain('VAT no. 4123456789');
    expect(t).toContain('Sandton');
  });

  it('does not throw on characters the standard font cannot encode (emoji, CJK, control chars)', async () => {
    const bytes = await renderInvoicePdf({
      ...base,
      buyer: { name: 'Zoë’s Shop 🚀 東京\u0000\u0007', email: 'z@example.com' },
    });
    const t = pdfText(bytes);
    expect(t).toContain('Zo');
    expect(await PDFDocument.load(bytes)).toBeTruthy();
  });

  it('wraps very long names instead of overflowing, and survives an unbroken 300-char word', async () => {
    const bytes = await renderInvoicePdf({
      ...base,
      buyer: { name: 'A'.repeat(300) },
    });
    expect((await PDFDocument.load(bytes)).getPageCount()).toBe(1);
  });

  it('is deterministic for the same input (no clock or randomness)', async () => {
    const a = await renderInvoicePdf(base);
    const b = await renderInvoicePdf(base);
    expect(Buffer.from(a).equals(Buffer.from(b))).toBe(true);
  });
});
