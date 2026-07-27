/**
 * File Parser Lambda — CSV and Excel file parsing with column-to-Product field mapping.
 * Requirements: 2.1, 2.2
 *
 * Responsibilities:
 * - Parse CSV files with auto-detection of delimiters (comma, semicolon, tab, pipe) and headers
 * - Parse Excel (.xlsx) files iterating all worksheets
 * - Map column headers to Product field names (title, sku, price, description, images, category, brand)
 * - Return an array of parsed records with source row indices for traceability
 */

import { parse } from 'csv-parse/sync';
import ExcelJS from 'exceljs';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/**
 * A single parsed product record extracted from a file source.
 * Contains mapped product fields and traceability metadata.
 */
export interface ParsedRecord {
  /** Product title / name */
  title?: string | undefined;
  /** Stock keeping unit identifier */
  sku?: string | undefined;
  /** Raw price value (string — normalisation happens in validation engine) */
  price?: string | undefined;
  /** Product description */
  description?: string | undefined;
  /** Array of image URLs or paths */
  images: string[];
  /** Product category */
  category?: string | undefined;
  /** Product brand */
  brand?: string | undefined;
  /** 1-based row index in the source file for traceability */
  sourceRowIndex: number;
  /** Name of the source worksheet (Excel only) */
  sourceSheet?: string | undefined;
}

/**
 * Result of parsing a file, containing all extracted records and metadata.
 */
export interface FileParseResult {
  records: ParsedRecord[];
  totalRows: number;
  /** Headers detected/mapped from the source file */
  detectedHeaders: string[];
  /** The delimiter detected for CSV parsing */
  detectedDelimiter?: string;
}

// ---------------------------------------------------------------------------
// Header Mapping
// ---------------------------------------------------------------------------

/**
 * Mapping of normalised header patterns to canonical Product field names.
 * Headers are matched case-insensitively, with whitespace and special characters stripped.
 */
const HEADER_MAPPINGS: Record<string, string[]> = {
  title: ['title', 'name', 'productname', 'product_name', 'product name', 'item', 'itemname', 'item_name', 'productitle', 'product_title'],
  sku: ['sku', 'skucode', 'sku_code', 'itemcode', 'item_code', 'productcode', 'product_code', 'articleno', 'article_no', 'partnumber', 'part_number', 'barcode', 'upc', 'ean'],
  price: ['price', 'unitprice', 'unit_price', 'saleprice', 'sale_price', 'cost', 'retailprice', 'retail_price', 'msrp', 'amount'],
  description: ['description', 'desc', 'productdescription', 'product_description', 'details', 'summary', 'longdescription', 'long_description'],
  images: ['image', 'images', 'imageurl', 'image_url', 'imagelink', 'image_link', 'photo', 'photos', 'picture', 'thumbnail', 'heroimage', 'hero_image', 'img', 'img_url'],
  category: ['category', 'categories', 'productcategory', 'product_category', 'type', 'producttype', 'product_type', 'group', 'department'],
  brand: ['brand', 'brandname', 'brand_name', 'manufacturer', 'maker', 'vendor', 'supplier'],
};

/**
 * Normalise a header string for comparison: lowercase, strip non-alphanumeric characters.
 */
function normaliseHeader(header: string): string {
  return header.toLowerCase().replace(/[^a-z0-9]/g, '');
}

/**
 * Map a raw column header to a canonical Product field name.
 * Returns undefined if no mapping is found.
 */
export function mapHeaderToField(header: string): string | undefined {
  const normalised = normaliseHeader(header);
  for (const [field, patterns] of Object.entries(HEADER_MAPPINGS)) {
    for (const pattern of patterns) {
      if (normalised === normaliseHeader(pattern)) {
        return field;
      }
    }
  }
  return undefined;
}

/**
 * Build a mapping from column index to canonical field name based on headers.
 */
function buildColumnMapping(headers: string[]): Map<number, string> {
  const mapping = new Map<number, string>();
  for (let i = 0; i < headers.length; i++) {
    const header = headers[i];
    if (header) {
      const field = mapHeaderToField(header);
      if (field) {
        mapping.set(i, field);
      }
    }
  }
  return mapping;
}

// ---------------------------------------------------------------------------
// CSV Parsing
// ---------------------------------------------------------------------------

/** Supported CSV delimiters in order of preference for auto-detection. */
const DELIMITERS = [',', ';', '\t', '|'];

/**
 * Auto-detect the delimiter used in a CSV string by counting occurrences
 * in the first few lines and picking the most consistent one.
 */
export function detectDelimiter(content: string): string {
  const lines = content.split(/\r?\n/).filter((line) => line.trim().length > 0);
  const sampleLines = lines.slice(0, Math.min(10, lines.length));

  if (sampleLines.length === 0) {
    return ',';
  }

  let bestDelimiter = ',';
  let bestScore = -1;

  for (const delimiter of DELIMITERS) {
    const counts = sampleLines.map((line) => {
      // Count delimiter occurrences outside of quoted fields
      let count = 0;
      let inQuotes = false;
      for (const char of line) {
        if (char === '"') {
          inQuotes = !inQuotes;
        } else if (char === delimiter && !inQuotes) {
          count++;
        }
      }
      return count;
    });

    // A good delimiter should appear consistently across lines
    const minCount = Math.min(...counts);
    const maxCount = Math.max(...counts);

    // Score: prefer delimiters that appear at least once and are consistent
    if (minCount > 0 && maxCount - minCount <= 1) {
      const avgCount = counts.reduce((a, b) => a + b, 0) / counts.length;
      if (avgCount > bestScore) {
        bestScore = avgCount;
        bestDelimiter = delimiter;
      }
    }
  }

  return bestDelimiter;
}

/**
 * Parse a CSV file buffer into structured product records.
 *
 * @param content - Raw CSV file content as a Buffer or string
 * @returns FileParseResult with parsed records and metadata
 */
export function parseCsv(content: Buffer | string): FileParseResult {
  const textContent = typeof content === 'string' ? content : content.toString('utf-8');

  const delimiter = detectDelimiter(textContent);

  const rawRecords: string[][] = parse(textContent, {
    delimiter,
    relax_column_count: true,
    skip_empty_lines: true,
    trim: true,
  });

  if (rawRecords.length === 0) {
    return { records: [], totalRows: 0, detectedHeaders: [], detectedDelimiter: delimiter };
  }

  // First row is treated as headers
  const headers = rawRecords[0] ?? [];
  const columnMapping = buildColumnMapping(headers);
  const dataRows = rawRecords.slice(1);

  const records: ParsedRecord[] = [];

  for (let rowIdx = 0; rowIdx < dataRows.length; rowIdx++) {
    const row = dataRows[rowIdx] ?? [];
    const record = rowToRecord(row, columnMapping, rowIdx + 2); // +2 because 1-based and header is row 1
    records.push(record);
  }

  return {
    records,
    totalRows: dataRows.length,
    detectedHeaders: headers,
    detectedDelimiter: delimiter,
  };
}

// ---------------------------------------------------------------------------
// Excel Parsing
// ---------------------------------------------------------------------------

/**
 * Parse an Excel (.xlsx) file buffer into structured product records.
 * Iterates all worksheets and merges results.
 *
 * @param content - Raw Excel file content as a Buffer
 * @returns FileParseResult with parsed records and metadata from all sheets
 */
export async function parseExcel(content: Buffer): Promise<FileParseResult> {
  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.load(content);

  const allRecords: ParsedRecord[] = [];
  let detectedHeaders: string[] = [];
  let totalRows = 0;

  workbook.eachSheet((worksheet) => {
    const sheetName = worksheet.name;
    const rows: (string | undefined)[][] = [];

    worksheet.eachRow((row, _rowNumber) => {
      const values: (string | undefined)[] = [];
      // ExcelJS row values are 1-indexed; index 0 is undefined
      row.eachCell({ includeEmpty: true }, (cell, colNumber) => {
        // Ensure the values array is large enough
        while (values.length < colNumber) {
          values.push(undefined);
        }
        values[colNumber - 1] = cellToString(cell);
      });
      rows.push(values);
    });

    if (rows.length === 0) {
      return; // Skip empty worksheets
    }

    // First row is treated as headers
    const firstRow = rows[0];
    if (!firstRow) {
      return;
    }
    const headers = firstRow.map((h) => h ?? '');

    // Capture headers from first non-empty sheet for metadata
    if (detectedHeaders.length === 0) {
      detectedHeaders = headers;
    }

    const columnMapping = buildColumnMapping(headers);
    const dataRows = rows.slice(1);

    for (let rowIdx = 0; rowIdx < dataRows.length; rowIdx++) {
      const row = dataRows[rowIdx];
      if (!row) continue;
      const stringRow = row.map((v) => v ?? '');
      const record = rowToRecord(stringRow, columnMapping, rowIdx + 2, sheetName); // +2: 1-based + header row
      allRecords.push(record);
    }

    totalRows += dataRows.length;
  });

  return {
    records: allRecords,
    totalRows,
    detectedHeaders,
  };
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Convert an ExcelJS cell value to a string representation.
 */
function cellToString(cell: ExcelJS.Cell): string {
  const value = cell.value;
  if (value === null || value === undefined) {
    return '';
  }
  if (typeof value === 'object') {
    // Handle rich text
    if ('richText' in value && Array.isArray((value as ExcelJS.CellRichTextValue).richText)) {
      return (value as ExcelJS.CellRichTextValue).richText.map((rt) => rt.text).join('');
    }
    // Handle hyperlinks
    if ('text' in value) {
      return String((value as ExcelJS.CellHyperlinkValue).text);
    }
    // Handle dates
    if (value instanceof Date) {
      return value.toISOString();
    }
    // Handle formula results
    if ('result' in value) {
      return String((value as ExcelJS.CellFormulaValue).result ?? '');
    }
    return String(value);
  }
  return String(value);
}

/**
 * Convert a raw row (array of string values) into a ParsedRecord using the column mapping.
 */
function rowToRecord(
  row: string[],
  columnMapping: Map<number, string>,
  sourceRowIndex: number,
  sourceSheet?: string
): ParsedRecord {
  const record: ParsedRecord = {
    images: [],
    sourceRowIndex,
    sourceSheet,
  };

  for (const [colIdx, field] of columnMapping) {
    const value = row[colIdx]?.trim() ?? '';
    if (!value) continue;

    switch (field) {
      case 'title':
        record.title = value;
        break;
      case 'sku':
        record.sku = value;
        break;
      case 'price':
        record.price = value;
        break;
      case 'description':
        record.description = value;
        break;
      case 'images':
        // Images may be a single URL or multiple URLs separated by commas/semicolons/pipes
        record.images = parseImageList(value);
        break;
      case 'category':
        record.category = value;
        break;
      case 'brand':
        record.brand = value;
        break;
    }
  }

  return record;
}

/**
 * Parse an image value that may contain multiple URLs separated by common delimiters.
 */
function parseImageList(value: string): string[] {
  // Split on common separators (comma, semicolon, pipe) but not within URLs
  const images = value
    .split(/[;|]/)
    .flatMap((segment) => {
      // If the segment looks like it has multiple comma-separated URLs, split further
      // but don't split on commas within URLs (simplistic heuristic: split on ", " or standalone commas)
      if (segment.includes(',') && !segment.match(/^https?:\/\/[^,]+$/)) {
        return segment.split(',');
      }
      return [segment];
    })
    .map((url) => url.trim())
    .filter((url) => url.length > 0);

  return images;
}
