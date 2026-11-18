/**
 * Renders an invoice as a single-page A4 PDF (pdf-lib, pure JS: no native
 * binaries, fonts or filesystem access, so it bundles cleanly into a Lambda).
 *
 * This is a plain "Invoice" for a supplier that is not VAT registered: it never
 * says "Tax Invoice" and shows no VAT line. The renderer is a pure function of
 * its input (no I/O, no clock) so it can be unit tested.
 */
import { PDFDocument, StandardFonts, rgb, type PDFFont, type PDFPage } from 'pdf-lib';
import type { InvoiceIssuer } from '../config/invoice-issuer';

export interface InvoiceBuyer {
  name: string;
  email?: string | undefined;
  registrationNumber?: string | undefined;
  /** The buyer's own VAT number, if they gave one (informational only). */
  vatNumber?: string | undefined;
  addressLines?: string[] | undefined;
}

export interface InvoiceLine {
  description: string;
  quantity: number;
  unitCents: number;
  totalCents: number;
}

export interface InvoiceDocumentData {
  invoiceNumber: string;
  /** ISO 8601 date the invoice was issued. */
  issuedAt: string;
  issuer: InvoiceIssuer;
  buyer: InvoiceBuyer;
  lines: InvoiceLine[];
  /** Discount applied (positive cents) with the voucher code that gave it. */
  discount?: { code: string; cents: number } | undefined;
  /** Amount due = sum of lines - discount (integer cents). */
  totalCents: number;
  currency: string;
  /** Payment reference (PayFast m_payment_id). */
  paymentReference: string;
  paymentMethod: string;
  periodStart?: string | undefined;
  periodEnd?: string | undefined;
}

const PAGE = { width: 595.28, height: 841.89 }; // A4 in points
const MARGIN = 50;
const INK = rgb(0.1, 0.1, 0.12);
const MUTED = rgb(0.4, 0.42, 0.46);
const RULE = rgb(0.82, 0.84, 0.87);

/** Formats integer cents as e.g. "R1,999.00" (ZAR) or "USD 12.00". */
export function formatMoney(cents: number, currency: string): string {
  const negative = cents < 0;
  const abs = Math.abs(cents);
  const whole = Math.floor(abs / 100)
    .toString()
    .replace(/\B(?=(\d{3})+(?!\d))/g, ',');
  const frac = (abs % 100).toString().padStart(2, '0');
  const symbol = currency === 'ZAR' ? 'R' : `${currency} `;
  return `${negative ? '-' : ''}${symbol}${whole}.${frac}`;
}

/** "17 November 2026" (UTC, so the output never depends on the server time zone). */
export function formatLongDate(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  const months = [
    'January', 'February', 'March', 'April', 'May', 'June',
    'July', 'August', 'September', 'October', 'November', 'December',
  ];
  return `${d.getUTCDate()} ${months[d.getUTCMonth()]} ${d.getUTCFullYear()}`;
}

/**
 * Standard PDF fonts only cover WinAnsi (Latin-1-ish). Names typed by users can
 * contain anything, and drawing an unencodable character throws, so replace
 * those with '?' instead of failing the whole invoice. Also strips control chars.
 */
export function toWinAnsi(font: PDFFont, text: string): string {
  let out = '';
  for (const ch of text.replace(/[\u0000-\u001F\u007F]/g, ' ')) {
    try {
      font.encodeText(ch);
      out += ch;
    } catch {
      out += '?';
    }
  }
  return out;
}

/** Greedy word wrap to `maxWidth` points. A single over-long word is hard-split. */
function wrap(font: PDFFont, text: string, size: number, maxWidth: number): string[] {
  const lines: string[] = [];
  let current = '';
  const push = (word: string) => {
    const candidate = current ? `${current} ${word}` : word;
    if (font.widthOfTextAtSize(candidate, size) <= maxWidth) {
      current = candidate;
      return;
    }
    if (current) lines.push(current);
    current = '';
    // Hard-split a word wider than the line.
    let chunk = '';
    for (const ch of word) {
      if (font.widthOfTextAtSize(chunk + ch, size) > maxWidth && chunk) {
        lines.push(chunk);
        chunk = '';
      }
      chunk += ch;
    }
    current = chunk;
  };
  for (const word of text.split(/\s+/).filter(Boolean)) push(word);
  if (current) lines.push(current);
  return lines.length ? lines : [''];
}

export async function renderInvoicePdf(data: InvoiceDocumentData): Promise<Uint8Array> {
  const doc = await PDFDocument.create();
  doc.setTitle(`Invoice ${data.invoiceNumber}`);
  doc.setProducer('MerchOS');
  doc.setCreator('MerchOS');
  doc.setCreationDate(new Date(data.issuedAt));
  doc.setModificationDate(new Date(data.issuedAt));

  const page = doc.addPage([PAGE.width, PAGE.height]);
  const regular = await doc.embedFont(StandardFonts.Helvetica);
  const bold = await doc.embedFont(StandardFonts.HelveticaBold);

  const text = (
    p: PDFPage,
    value: string,
    x: number,
    y: number,
    size: number,
    font: PDFFont,
    color = INK
  ) => p.drawText(toWinAnsi(font, value), { x, y, size, font, color });

  const textRight = (
    p: PDFPage,
    value: string,
    rightX: number,
    y: number,
    size: number,
    font: PDFFont,
    color = INK
  ) => {
    const safe = toWinAnsi(font, value);
    p.drawText(safe, { x: rightX - font.widthOfTextAtSize(safe, size), y, size, font, color });
  };

  const rule = (p: PDFPage, y: number) =>
    p.drawLine({
      start: { x: MARGIN, y },
      end: { x: PAGE.width - MARGIN, y },
      thickness: 0.7,
      color: RULE,
    });

  const right = PAGE.width - MARGIN;
  let y = PAGE.height - MARGIN;

  // ---- Header: issuer on the left, document title on the right -------------
  const issuerName = data.issuer.legalName;
  text(page, issuerName, MARGIN, y - 14, 16, bold);
  let issuerY = y - 32;
  const issuerLines = [
    ...(data.issuer.tradingName && data.issuer.tradingName !== issuerName
      ? [`Trading as ${data.issuer.tradingName}`]
      : []),
    ...(data.issuer.registrationNumber ? [`Reg. no. ${data.issuer.registrationNumber}`] : []),
    ...data.issuer.addressLines,
    data.issuer.email,
    ...(data.issuer.website ? [data.issuer.website] : []),
  ];
  for (const line of issuerLines) {
    text(page, line, MARGIN, issuerY, 9.5, regular, MUTED);
    issuerY -= 12.5;
  }

  textRight(page, 'INVOICE', right, y - 16, 22, bold);
  textRight(page, `No. ${data.invoiceNumber}`, right, y - 36, 11, regular);
  textRight(page, `Date: ${formatLongDate(data.issuedAt)}`, right, y - 51, 10, regular, MUTED);
  textRight(page, 'Status: PAID', right, y - 66, 10, bold);

  y = Math.min(issuerY, y - 80) - 14;
  rule(page, y);
  y -= 24;

  // ---- Bill to ---------------------------------------------------------------
  text(page, 'BILL TO', MARGIN, y, 8.5, bold, MUTED);
  y -= 15;
  for (const nameLine of wrap(bold, toWinAnsi(bold, data.buyer.name), 11, 260)) {
    text(page, nameLine, MARGIN, y, 11, bold);
    y -= 14;
  }
  const buyerLines = [
    ...(data.buyer.registrationNumber ? [`Reg. no. ${data.buyer.registrationNumber}`] : []),
    ...(data.buyer.vatNumber ? [`VAT no. ${data.buyer.vatNumber}`] : []),
    ...(data.buyer.addressLines ?? []),
    ...(data.buyer.email ? [data.buyer.email] : []),
  ];
  for (const line of buyerLines) {
    for (const wrapped of wrap(regular, toWinAnsi(regular, line), 9.5, 260)) {
      text(page, wrapped, MARGIN, y, 9.5, regular, MUTED);
      y -= 12.5;
    }
  }

  y -= 18;

  // ---- Line items ------------------------------------------------------------
  const colQty = 360;
  const colUnit = 450;
  text(page, 'DESCRIPTION', MARGIN, y, 8.5, bold, MUTED);
  textRight(page, 'QTY', colQty, y, 8.5, bold, MUTED);
  textRight(page, 'UNIT PRICE', colUnit, y, 8.5, bold, MUTED);
  textRight(page, 'AMOUNT', right, y, 8.5, bold, MUTED);
  y -= 8;
  rule(page, y);
  y -= 18;

  for (const line of data.lines) {
    const descLines = wrap(regular, toWinAnsi(regular, line.description), 10, colQty - MARGIN - 40);
    text(page, descLines[0] ?? '', MARGIN, y, 10, regular);
    textRight(page, String(line.quantity), colQty, y, 10, regular);
    textRight(page, formatMoney(line.unitCents, data.currency), colUnit, y, 10, regular);
    textRight(page, formatMoney(line.totalCents, data.currency), right, y, 10, regular);
    for (const extra of descLines.slice(1)) {
      y -= 13;
      text(page, extra, MARGIN, y, 10, regular);
    }
    if (data.periodStart && data.periodEnd) {
      y -= 13;
      text(
        page,
        `Service period: ${formatLongDate(data.periodStart)} to ${formatLongDate(data.periodEnd)}`,
        MARGIN,
        y,
        8.5,
        regular,
        MUTED
      );
    }
    y -= 20;
  }

  if (data.discount && data.discount.cents > 0) {
    text(page, `Discount (voucher ${data.discount.code})`, MARGIN, y, 10, regular);
    textRight(page, formatMoney(-data.discount.cents, data.currency), right, y, 10, regular);
    y -= 20;
  }

  rule(page, y + 6);
  y -= 14;
  textRight(page, 'Total due', 440, y, 11, bold);
  textRight(page, formatMoney(data.totalCents, data.currency), right, y, 11, bold);
  y -= 16;
  textRight(page, 'Amount paid', 440, y, 10, regular);
  textRight(page, formatMoney(data.totalCents, data.currency), right, y, 10, regular);
  y -= 16;
  textRight(page, 'Balance due', 440, y, 10, regular);
  textRight(page, formatMoney(0, data.currency), right, y, 10, regular);

  y -= 34;
  text(page, 'PAYMENT', MARGIN, y, 8.5, bold, MUTED);
  y -= 15;
  text(page, `Paid via ${data.paymentMethod}`, MARGIN, y, 9.5, regular);
  y -= 12.5;
  text(page, `Payment reference: ${data.paymentReference}`, MARGIN, y, 9.5, regular, MUTED);

  // ---- Footer ----------------------------------------------------------------
  rule(page, 78);
  text(
    page,
    'No VAT has been charged: the supplier is not registered for VAT. This document is an invoice, not a tax invoice.',
    MARGIN,
    62,
    8.5,
    regular,
    MUTED
  );
  text(
    page,
    'Amounts are in South African Rand (ZAR) unless stated otherwise.',
    MARGIN,
    50,
    8.5,
    regular,
    MUTED
  );

  return doc.save({ useObjectStreams: false });
}
