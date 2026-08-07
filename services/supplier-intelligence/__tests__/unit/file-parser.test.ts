/**
 * Unit tests for the CSV/Excel file parser.
 * Requirements: 2.1, 2.2
 */
import { describe, it, expect } from 'vitest';
import ExcelJS from 'exceljs';
import {
  parseCsv,
  parseExcel,
  detectDelimiter,
  mapHeaderToField,
} from '../../processors/file-parser';

// ---------------------------------------------------------------------------
// detectDelimiter
// ---------------------------------------------------------------------------

describe('detectDelimiter', () => {
  it('detects comma delimiter', () => {
    const content = 'title,sku,price\nShirt,SKU001,19.99\nPants,SKU002,29.99';
    expect(detectDelimiter(content)).toBe(',');
  });

  it('detects semicolon delimiter', () => {
    const content = 'title;sku;price\nShirt;SKU001;19.99\nPants;SKU002;29.99';
    expect(detectDelimiter(content)).toBe(';');
  });

  it('detects tab delimiter', () => {
    const content = 'title\tsku\tprice\nShirt\tSKU001\t19.99\nPants\tSKU002\t29.99';
    expect(detectDelimiter(content)).toBe('\t');
  });

  it('detects pipe delimiter', () => {
    const content = 'title|sku|price\nShirt|SKU001|19.99\nPants|SKU002|29.99';
    expect(detectDelimiter(content)).toBe('|');
  });

  it('defaults to comma for empty content', () => {
    expect(detectDelimiter('')).toBe(',');
  });
});

// ---------------------------------------------------------------------------
// mapHeaderToField
// ---------------------------------------------------------------------------

describe('mapHeaderToField', () => {
  it('maps standard product field names', () => {
    expect(mapHeaderToField('title')).toBe('title');
    expect(mapHeaderToField('SKU')).toBe('sku');
    expect(mapHeaderToField('Price')).toBe('price');
    expect(mapHeaderToField('Description')).toBe('description');
    expect(mapHeaderToField('Image')).toBe('images');
    expect(mapHeaderToField('Category')).toBe('category');
    expect(mapHeaderToField('Brand')).toBe('brand');
  });

  it('maps alternative header names case-insensitively', () => {
    expect(mapHeaderToField('Product Name')).toBe('title');
    expect(mapHeaderToField('ITEM_CODE')).toBe('sku');
    expect(mapHeaderToField('unit_price')).toBe('price');
    expect(mapHeaderToField('long description')).toBe('description');
    expect(mapHeaderToField('Image URL')).toBe('images');
    expect(mapHeaderToField('Product Type')).toBe('category');
    expect(mapHeaderToField('Manufacturer')).toBe('brand');
  });

  it('returns undefined for unrecognised headers', () => {
    expect(mapHeaderToField('foo_bar')).toBeUndefined();
    expect(mapHeaderToField('random_col')).toBeUndefined();
    expect(mapHeaderToField('')).toBeUndefined();
  });
});

// ---------------------------------------------------------------------------
// parseCsv
// ---------------------------------------------------------------------------

describe('parseCsv', () => {
  it('parses a simple CSV with standard headers', () => {
    const csv = [
      'title,sku,price,description,brand,category,image',
      'Blue Shirt,SKU001,19.99,A nice shirt,Nike,Apparel,https://img.com/shirt.jpg',
      'Red Pants,SKU002,29.99,Comfy pants,Adidas,Clothing,https://img.com/pants.jpg',
    ].join('\n');

    const result = parseCsv(csv);

    expect(result.totalRows).toBe(2);
    expect(result.records).toHaveLength(2);
    expect(result.detectedDelimiter).toBe(',');
    expect(result.detectedHeaders).toEqual(['title', 'sku', 'price', 'description', 'brand', 'category', 'image']);

    const first = result.records[0]!;
    expect(first.title).toBe('Blue Shirt');
    expect(first.sku).toBe('SKU001');
    expect(first.price).toBe('19.99');
    expect(first.description).toBe('A nice shirt');
    expect(first.brand).toBe('Nike');
    expect(first.category).toBe('Apparel');
    expect(first.images).toEqual(['https://img.com/shirt.jpg']);
    expect(first.sourceRowIndex).toBe(2); // 1-based, header is row 1
  });

  it('handles semicolon-delimited CSV', () => {
    const csv = 'Name;SKU Code;Unit Price\nWidget;W001;5.50\nGadget;G001;12.00';
    const result = parseCsv(csv);

    expect(result.detectedDelimiter).toBe(';');
    expect(result.records).toHaveLength(2);
    expect(result.records[0]!.title).toBe('Widget');
    expect(result.records[0]!.sku).toBe('W001');
    expect(result.records[0]!.price).toBe('5.50');
  });

  it('handles tab-delimited CSV', () => {
    const csv = 'Product Name\tArticle No\tRetail Price\nLaptop\tLAP001\t999.99';
    const result = parseCsv(csv);

    expect(result.detectedDelimiter).toBe('\t');
    expect(result.records[0]!.title).toBe('Laptop');
    expect(result.records[0]!.sku).toBe('LAP001');
    expect(result.records[0]!.price).toBe('999.99');
  });

  it('handles empty CSV content', () => {
    const result = parseCsv('');
    expect(result.records).toHaveLength(0);
    expect(result.totalRows).toBe(0);
  });

  it('handles CSV with only headers and no data rows', () => {
    const csv = 'title,sku,price\n';
    const result = parseCsv(csv);
    expect(result.records).toHaveLength(0);
    expect(result.totalRows).toBe(0);
  });

  it('handles multiple images separated by semicolons', () => {
    const csv = 'title,sku,images\nWidget,W001,https://img.com/1.jpg;https://img.com/2.jpg';
    const result = parseCsv(csv);

    expect(result.records[0]!.images).toEqual([
      'https://img.com/1.jpg',
      'https://img.com/2.jpg',
    ]);
  });

  it('handles Buffer input', () => {
    const csv = 'title,sku,price\nTest Product,TP001,15.00';
    const buffer = Buffer.from(csv, 'utf-8');
    const result = parseCsv(buffer);

    expect(result.records).toHaveLength(1);
    expect(result.records[0]!.title).toBe('Test Product');
  });

  it('assigns correct source row indices', () => {
    const csv = 'title,sku\nA,A001\nB,B001\nC,C001';
    const result = parseCsv(csv);

    expect(result.records[0]!.sourceRowIndex).toBe(2);
    expect(result.records[1]!.sourceRowIndex).toBe(3);
    expect(result.records[2]!.sourceRowIndex).toBe(4);
  });

  it('skips empty field values gracefully', () => {
    const csv = 'title,sku,price,description\nOnly Title,SKU001,,';
    const result = parseCsv(csv);

    expect(result.records[0]!.title).toBe('Only Title');
    expect(result.records[0]!.sku).toBe('SKU001');
    expect(result.records[0]!.price).toBeUndefined();
    expect(result.records[0]!.description).toBeUndefined();
  });

  it('maps alternative headers like "Product Name" and "Item Code"', () => {
    const csv = 'Product Name,Item Code,Sale Price,Brand Name\nWidget,WG001,9.99,Acme';
    const result = parseCsv(csv);

    expect(result.records[0]!.title).toBe('Widget');
    expect(result.records[0]!.sku).toBe('WG001');
    expect(result.records[0]!.price).toBe('9.99');
    expect(result.records[0]!.brand).toBe('Acme');
  });
});

// ---------------------------------------------------------------------------
// parseExcel
// ---------------------------------------------------------------------------

describe('parseExcel', () => {
  async function createExcelBuffer(
    sheets: { name: string; data: string[][] }[]
  ): Promise<Buffer> {
    const workbook = new ExcelJS.Workbook();
    for (const sheet of sheets) {
      const ws = workbook.addWorksheet(sheet.name);
      for (const row of sheet.data) {
        ws.addRow(row);
      }
    }
    const arrayBuffer = await workbook.xlsx.writeBuffer();
    return Buffer.from(arrayBuffer);
  }

  it('parses a single-sheet Excel file with standard headers', async () => {
    const buffer = await createExcelBuffer([
      {
        name: 'Products',
        data: [
          ['title', 'sku', 'price', 'description', 'brand', 'category'],
          ['Shirt', 'SKU001', '19.99', 'A nice shirt', 'Nike', 'Apparel'],
          ['Pants', 'SKU002', '29.99', 'Comfy pants', 'Adidas', 'Clothing'],
        ],
      },
    ]);

    const result = await parseExcel(buffer);

    expect(result.totalRows).toBe(2);
    expect(result.records).toHaveLength(2);
    expect(result.records[0]!.title).toBe('Shirt');
    expect(result.records[0]!.sku).toBe('SKU001');
    expect(result.records[0]!.price).toBe('19.99');
    expect(result.records[0]!.brand).toBe('Nike');
    expect(result.records[0]!.sourceSheet).toBe('Products');
    expect(result.records[0]!.sourceRowIndex).toBe(2);
  });

  it('merges records from multiple worksheets', async () => {
    const buffer = await createExcelBuffer([
      {
        name: 'Electronics',
        data: [
          ['title', 'sku', 'price'],
          ['Laptop', 'E001', '999.99'],
        ],
      },
      {
        name: 'Clothing',
        data: [
          ['title', 'sku', 'price'],
          ['Shirt', 'C001', '19.99'],
          ['Pants', 'C002', '29.99'],
        ],
      },
    ]);

    const result = await parseExcel(buffer);

    expect(result.totalRows).toBe(3);
    expect(result.records).toHaveLength(3);
    expect(result.records[0]!.sourceSheet).toBe('Electronics');
    expect(result.records[1]!.sourceSheet).toBe('Clothing');
    expect(result.records[2]!.sourceSheet).toBe('Clothing');
  });

  it('handles empty worksheets gracefully', async () => {
    const buffer = await createExcelBuffer([
      { name: 'Empty', data: [] },
      {
        name: 'WithData',
        data: [
          ['title', 'sku'],
          ['Product', 'P001'],
        ],
      },
    ]);

    const result = await parseExcel(buffer);

    expect(result.records).toHaveLength(1);
    expect(result.records[0]!.title).toBe('Product');
  });

  it('assigns correct source row indices per worksheet', async () => {
    const buffer = await createExcelBuffer([
      {
        name: 'Sheet1',
        data: [
          ['title', 'sku'],
          ['A', 'A001'],
          ['B', 'B001'],
        ],
      },
    ]);

    const result = await parseExcel(buffer);

    expect(result.records[0]!.sourceRowIndex).toBe(2);
    expect(result.records[1]!.sourceRowIndex).toBe(3);
  });

  it('maps alternative column headers in Excel', async () => {
    const buffer = await createExcelBuffer([
      {
        name: 'Products',
        data: [
          ['Product Name', 'SKU Code', 'Unit Price', 'Manufacturer'],
          ['Widget', 'WG001', '5.50', 'Acme Corp'],
        ],
      },
    ]);

    const result = await parseExcel(buffer);

    expect(result.records[0]!.title).toBe('Widget');
    expect(result.records[0]!.sku).toBe('WG001');
    expect(result.records[0]!.price).toBe('5.50');
    expect(result.records[0]!.brand).toBe('Acme Corp');
  });
});
