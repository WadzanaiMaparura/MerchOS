/**
 * Unit tests for the PDF parser processor.
 * Requirements: 2.3
 */
import { describe, it, expect, vi } from 'vitest';

// Mock pdf-parse since we can't create real PDF buffers easily in unit tests
vi.mock('pdf-parse', () => ({
  default: vi.fn(),
}));

import pdfParse from 'pdf-parse';
import { parsePdf } from '../../processors/pdf-parser';

const mockPdfParse = vi.mocked(pdfParse);

// ---------------------------------------------------------------------------
// parsePdf — single-line product entries
// ---------------------------------------------------------------------------

describe('parsePdf', () => {
  it('extracts products from single-line entries with SKU and price', async () => {
    mockPdfParse.mockResolvedValue({
      text: [
        'Product Catalogue - Spring 2024',
        '',
        'Blue Widget SKU-1234 $19.99',
        'Red Gadget SKU-5678 $29.50',
        'Green Doohickey SKU-9012 $5.00',
      ].join('\n'),
      numpages: 1,
      numrender: 1,
      info: {},
      metadata: null,
      version: '1.0',
    } as any);

    const result = await parsePdf(Buffer.from('fake-pdf'));

    expect(result.records.length).toBe(3);
    expect(result.records[0]!.sku).toBe('SKU-1234');
    expect(result.records[0]!.price).toBe('$19.99');
    expect(result.records[1]!.sku).toBe('SKU-5678');
    expect(result.records[1]!.price).toBe('$29.50');
    expect(result.records[2]!.sku).toBe('SKU-9012');
    expect(result.records[2]!.price).toBe('$5.00');
  });

  it('extracts products with labelled SKUs', async () => {
    mockPdfParse.mockResolvedValue({
      text: [
        'Premium Leather Bag',
        'SKU: LB-2024-A  $149.99',
        '',
        'Cotton T-Shirt',
        'Item #: CT-100  $24.99',
      ].join('\n'),
      numpages: 1,
      numrender: 1,
      info: {},
      metadata: null,
      version: '1.0',
    } as any);

    const result = await parsePdf(Buffer.from('fake-pdf'));

    expect(result.records.length).toBe(2);
    expect(result.records[0]!.sku).toBe('LB-2024-A');
    expect(result.records[0]!.price).toBe('$149.99');
    expect(result.records[0]!.title).toBe('Premium Leather Bag');
    expect(result.records[1]!.sku).toBe('CT-100');
    expect(result.records[1]!.price).toBe('$24.99');
    expect(result.records[1]!.title).toBe('Cotton T-Shirt');
  });

  it('handles different currency symbols', async () => {
    mockPdfParse.mockResolvedValue({
      text: [
        'Euro Product ABC123 €49.99',
        'Pound Product DEF456 £32.50',
        'Yen Product GHI789 ¥1000',
      ].join('\n'),
      numpages: 1,
      numrender: 1,
      info: {},
      metadata: null,
      version: '1.0',
    } as any);

    const result = await parsePdf(Buffer.from('fake-pdf'));

    expect(result.records.length).toBe(3);
    expect(result.records[0]!.price).toBe('€49.99');
    expect(result.records[1]!.price).toBe('£32.50');
    expect(result.records[2]!.price).toBe('¥1000');
  });

  it('returns empty results for empty PDF text', async () => {
    mockPdfParse.mockResolvedValue({
      text: '',
      numpages: 0,
      numrender: 0,
      info: {},
      metadata: null,
      version: '1.0',
    } as any);

    const result = await parsePdf(Buffer.from('fake-pdf'));

    expect(result.records).toHaveLength(0);
    expect(result.totalRows).toBe(0);
  });

  it('returns empty results for PDF with no product-like content', async () => {
    mockPdfParse.mockResolvedValue({
      text: [
        'Welcome to our company',
        'We are the best at what we do',
        'Contact us at hello@example.com',
      ].join('\n'),
      numpages: 1,
      numrender: 1,
      info: {},
      metadata: null,
      version: '1.0',
    } as any);

    const result = await parsePdf(Buffer.from('fake-pdf'));

    expect(result.records).toHaveLength(0);
  });

  it('assigns sequential 1-based sourceRowIndex to extracted records', async () => {
    mockPdfParse.mockResolvedValue({
      text: [
        'Product A SKU-001 $10.00',
        'Product B SKU-002 $20.00',
        'Product C SKU-003 $30.00',
      ].join('\n'),
      numpages: 1,
      numrender: 1,
      info: {},
      metadata: null,
      version: '1.0',
    } as any);

    const result = await parsePdf(Buffer.from('fake-pdf'));

    expect(result.records[0]!.sourceRowIndex).toBe(1);
    expect(result.records[1]!.sourceRowIndex).toBe(2);
    expect(result.records[2]!.sourceRowIndex).toBe(3);
  });

  it('records have empty images array', async () => {
    mockPdfParse.mockResolvedValue({
      text: 'Widget W001 $5.00\n',
      numpages: 1,
      numrender: 1,
      info: {},
      metadata: null,
      version: '1.0',
    } as any);

    const result = await parsePdf(Buffer.from('fake-pdf'));

    expect(result.records[0]!.images).toEqual([]);
  });

  it('detects headers based on fields found in extracted records', async () => {
    mockPdfParse.mockResolvedValue({
      text: [
        'Fancy Product SKU: FP-001 $99.99',
      ].join('\n'),
      numpages: 1,
      numrender: 1,
      info: {},
      metadata: null,
      version: '1.0',
    } as any);

    const result = await parsePdf(Buffer.from('fake-pdf'));

    expect(result.detectedHeaders).toContain('title');
    expect(result.detectedHeaders).toContain('sku');
    expect(result.detectedHeaders).toContain('price');
  });

  // ---------------------------------------------------------------------------
  // Tabular data detection
  // ---------------------------------------------------------------------------

  it('parses tab-separated tabular data from PDF', async () => {
    mockPdfParse.mockResolvedValue({
      text: [
        'Name\tSKU\tPrice',
        'Widget Alpha\tWA-001\t$12.99',
        'Widget Beta\tWB-002\t$15.99',
        'Widget Gamma\tWG-003\t$18.99',
      ].join('\n'),
      numpages: 1,
      numrender: 1,
      info: {},
      metadata: null,
      version: '1.0',
    } as any);

    const result = await parsePdf(Buffer.from('fake-pdf'));

    expect(result.records.length).toBe(3);
    expect(result.records[0]!.title).toBe('Widget Alpha');
    expect(result.records[0]!.sku).toBe('WA-001');
    expect(result.records[0]!.price).toBe('$12.99');
  });

  // ---------------------------------------------------------------------------
  // Multi-line block detection
  // ---------------------------------------------------------------------------

  it('extracts product name from preceding line in multi-line blocks', async () => {
    mockPdfParse.mockResolvedValue({
      text: [
        'Luxury Handbag',
        'SKU: LH-500 $299.00',
        '',
        'Casual Sneakers',
        'SKU: CS-200 $89.99',
      ].join('\n'),
      numpages: 1,
      numrender: 1,
      info: {},
      metadata: null,
      version: '1.0',
    } as any);

    const result = await parsePdf(Buffer.from('fake-pdf'));

    expect(result.records.length).toBe(2);
    expect(result.records[0]!.title).toBe('Luxury Handbag');
    expect(result.records[0]!.sku).toBe('LH-500');
    expect(result.records[1]!.title).toBe('Casual Sneakers');
    expect(result.records[1]!.sku).toBe('CS-200');
  });

  it('totalRows matches number of extracted records', async () => {
    mockPdfParse.mockResolvedValue({
      text: [
        'Item One AB1234 $10.00',
        'Item Two CD5678 $20.00',
      ].join('\n'),
      numpages: 1,
      numrender: 1,
      info: {},
      metadata: null,
      version: '1.0',
    } as any);

    const result = await parsePdf(Buffer.from('fake-pdf'));

    expect(result.totalRows).toBe(result.records.length);
  });
});
