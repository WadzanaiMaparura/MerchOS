/**
 * ZIP Archive Handler — extracts files from ZIP archives, identifies MIME types,
 * routes each file to the correct parser, and aggregates results.
 * Requirements: 2.4
 *
 * Responsibilities:
 * - Extract all entries from a ZIP archive buffer
 * - Identify MIME type per entry using file extension mapping
 * - Route CSV/Excel/PDF files to the appropriate parser
 * - Collect image files separately (they require OCR processing)
 * - Aggregate parsed product records from all sub-files into a single record set
 * - Track source file name in each record's metadata for traceability
 */

import AdmZip from 'adm-zip';
import { parseCsv, parseExcel, type ParsedRecord, type FileParseResult } from './file-parser';
import { parsePdf } from './pdf-parser';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/**
 * Aggregated result of parsing a ZIP archive.
 */
export interface ZipParseResult {
  /** All parsed product records from supported sub-files (CSV, Excel, PDF) */
  records: ParsedRecord[];
  /** File names of image entries that need OCR processing */
  images: string[];
  /** Total number of entries found in the ZIP archive (excluding directories) */
  totalFiles: number;
  /** Number of files successfully parsed into product records */
  parsedFiles: number;
  /** Number of files skipped (unsupported type, hidden, or system files) */
  skippedFiles: number;
}

// ---------------------------------------------------------------------------
// MIME Type Detection
// ---------------------------------------------------------------------------

/** File extension to parser category mapping. */
type FileCategory = 'csv' | 'excel' | 'pdf' | 'image' | 'unsupported';

/** Map of file extensions to file categories. */
const EXTENSION_CATEGORY_MAP: Record<string, FileCategory> = {
  '.csv': 'csv',
  '.xlsx': 'excel',
  '.pdf': 'pdf',
  '.jpg': 'image',
  '.jpeg': 'image',
  '.png': 'image',
  '.webp': 'image',
  '.gif': 'image',
};

/**
 * Determines the file category based on its extension.
 * Returns 'unsupported' for unrecognised extensions.
 */
export function getFileCategory(fileName: string): FileCategory {
  const lowerName = fileName.toLowerCase();
  const dotIndex = lowerName.lastIndexOf('.');
  if (dotIndex === -1) return 'unsupported';
  const ext = lowerName.substring(dotIndex);
  return EXTENSION_CATEGORY_MAP[ext] ?? 'unsupported';
}

/**
 * Determines whether a ZIP entry should be skipped (directories, hidden/system files).
 */
export function shouldSkipEntry(entryName: string): boolean {
  // Skip directories
  if (entryName.endsWith('/')) {
    return true;
  }

  // Skip macOS resource fork entries
  if (entryName.startsWith('__MACOSX/') || entryName.includes('/__MACOSX/')) {
    return true;
  }

  // Skip hidden files (Unix-style dot files)
  const baseName = entryName.split('/').pop() ?? '';
  if (baseName.startsWith('.')) {
    return true;
  }

  // Skip Windows Thumbs.db and desktop.ini
  const lowerBase = baseName.toLowerCase();
  if (lowerBase === 'thumbs.db' || lowerBase === 'desktop.ini') {
    return true;
  }

  return false;
}

// ---------------------------------------------------------------------------
// File Routing
// ---------------------------------------------------------------------------

/**
 * Routes a file buffer to the appropriate parser based on its category.
 * Returns parsed product records with the source file name injected into metadata.
 */
async function routeToParser(
  buffer: Buffer,
  category: 'csv' | 'excel' | 'pdf',
  sourceFileName: string,
): Promise<ParsedRecord[]> {
  let records: ParsedRecord[];

  switch (category) {
    case 'csv': {
      const result = parseCsv(buffer);
      records = result.records;
      break;
    }
    case 'excel': {
      const result = await parseExcel(buffer);
      records = result.records;
      break;
    }
    case 'pdf': {
      const result = await parsePdf(buffer);
      records = result.records;
      break;
    }
    default:
      records = [];
  }

  // Inject source file name into each record for traceability
  return records.map((record) => ({
    ...record,
    sourceSheet: record.sourceSheet ?? sourceFileName,
  }));
}

// ---------------------------------------------------------------------------
// Main ZIP Processing
// ---------------------------------------------------------------------------

/**
 * Parses a ZIP archive buffer, extracting all supported files,
 * routing each to the appropriate parser, and aggregating results.
 *
 * CSV, Excel, and PDF files are parsed into product records.
 * Image files (.jpg, .jpeg, .png, .webp, .gif) are collected as file names
 * for separate OCR processing.
 *
 * @param content - The raw ZIP archive content as a Buffer
 * @returns Aggregated ZipParseResult with records, image list, and statistics
 * @throws Error if the ZIP archive is corrupted or cannot be opened
 */
export async function parseZip(content: Buffer): Promise<ZipParseResult> {
  const zip = new AdmZip(content);
  const entries = zip.getEntries();

  const allRecords: ParsedRecord[] = [];
  const images: string[] = [];
  let totalFiles = 0;
  let parsedFiles = 0;
  let skippedFiles = 0;

  for (const entry of entries) {
    const entryName = entry.entryName;

    // Skip directories and hidden/system files
    if (shouldSkipEntry(entryName)) {
      continue;
    }

    // Count only actual files (not skipped system entries)
    totalFiles++;

    const category = getFileCategory(entryName);

    if (category === 'unsupported') {
      skippedFiles++;
      continue;
    }

    if (category === 'image') {
      // Images are not parsed here — they need OCR processing separately
      images.push(entryName);
      skippedFiles++;
      continue;
    }

    // Route parseable files (csv, excel, pdf) to the correct parser
    try {
      const fileBuffer = entry.getData();
      const records = await routeToParser(fileBuffer, category, entryName);
      allRecords.push(...records);
      parsedFiles++;
    } catch {
      // If a single file within the ZIP fails to parse, skip it and continue
      skippedFiles++;
    }
  }

  return {
    records: allRecords,
    images,
    totalFiles,
    parsedFiles,
    skippedFiles,
  };
}


// ---------------------------------------------------------------------------
// FileParseResult-compatible API
// ---------------------------------------------------------------------------

/**
 * Process a ZIP archive and return results in the standard FileParseResult format.
 * This function aggregates all parsed records from sub-files (CSV, Excel, PDF)
 * into a single record set, conforming to the common FileParseResult interface.
 *
 * Image files found in the archive are noted but not parsed here — they require
 * OCR processing via the image-processor module.
 *
 * Each record's `sourceSheet` field is populated with the source file name
 * within the archive for traceability.
 *
 * @param content - The raw ZIP archive content as a Buffer
 * @returns FileParseResult with aggregated records from all parseable sub-files
 * @throws Error if the ZIP archive is corrupted or cannot be opened
 */
export async function processZipArchive(content: Buffer): Promise<FileParseResult> {
  const zipResult = await parseZip(content);

  // Collect all unique detected headers across sub-files
  // We rebuild them from the aggregated records' field presence
  const detectedHeaders = detectHeadersFromRecords(zipResult.records);

  return {
    records: zipResult.records,
    totalRows: zipResult.records.length,
    detectedHeaders,
  };
}

/**
 * Determine which product fields were populated across all records
 * for reporting as detected headers.
 */
function detectHeadersFromRecords(records: ParsedRecord[]): string[] {
  const detected = new Set<string>();

  for (const record of records) {
    if (record.title) detected.add('title');
    if (record.sku) detected.add('sku');
    if (record.price) detected.add('price');
    if (record.description) detected.add('description');
    if (record.images.length > 0) detected.add('images');
    if (record.category) detected.add('category');
    if (record.brand) detected.add('brand');
  }

  return Array.from(detected);
}
