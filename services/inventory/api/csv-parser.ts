/**
 * CSV parsing for POST /inventory/import (Phase 8A contract).
 *
 * Responsibilities (HTTP/parse layer — business rules live in the service):
 *  - require the exact header `sku,warehouseId,onHand`
 *  - enforce max rows (1,000) and ignore blank lines
 *  - parse each row; quantity must be a non-negative integer
 *  - report malformed rows at the row level (does NOT abort other rows)
 *
 * Top-level failures (bad/missing header, too many rows, oversized body) are
 * surfaced to the handler as a thrown CsvContractError so the handler can
 * return a 4xx and process NO rows. Row-level parse failures are returned as
 * structured results so the handler can merge them with service results under
 * partial-success semantics.
 */

import type { CsvImportRow } from '../service';

export const CSV_MAX_ROWS = 1000;
export const CSV_MAX_BYTES = 1024 * 1024; // 1 MB
export const CSV_REQUIRED_HEADERS = ['sku', 'warehouseId', 'onHand'] as const;

export type CsvContractErrorCode =
  | 'CSV_INVALID_HEADER'
  | 'CSV_TOO_MANY_ROWS'
  | 'PAYLOAD_TOO_LARGE';

/** A whole-file failure: the handler returns 4xx and processes no rows. */
export class CsvContractError extends Error {
  constructor(public readonly code: CsvContractErrorCode, message: string) {
    super(message);
    this.name = 'CsvContractError';
  }
}

/** A row that failed to parse (bad field count or non-integer/negative qty). */
export interface CsvRowParseError {
  rowNumber: number;
  sku: string;
  warehouseId: string;
  error: { code: 'INVALID_ROW' | 'INVALID_QUANTITY' | 'NEGATIVE_QUANTITY'; message: string };
}

export interface CsvParseOutput {
  rows: CsvImportRow[];
  rowErrors: CsvRowParseError[];
}

function splitCsvLine(line: string): string[] {
  // Phase 8A CSV is simple: comma-separated, no embedded commas/quotes required.
  return line.split(',').map((c) => c.trim());
}

/**
 * Parse a raw CSV body into typed rows + per-row parse errors.
 *
 * @throws CsvContractError for whole-file contract violations.
 */
export function parseInventoryCsv(body: string): CsvParseOutput {
  if (Buffer.byteLength(body, 'utf-8') > CSV_MAX_BYTES) {
    throw new CsvContractError('PAYLOAD_TOO_LARGE', 'CSV body exceeds 1 MB');
  }

  const rawLines = body.split(/\r?\n/);

  // Find the header (first non-blank line).
  let headerIndex = -1;
  for (let i = 0; i < rawLines.length; i++) {
    if (rawLines[i]!.trim().length > 0) {
      headerIndex = i;
      break;
    }
  }
  if (headerIndex === -1) {
    throw new CsvContractError('CSV_INVALID_HEADER', 'CSV is empty; a header row is required');
  }

  const header = splitCsvLine(rawLines[headerIndex]!);
  const expected = CSV_REQUIRED_HEADERS;
  const headerMatches =
    header.length >= expected.length &&
    expected.every((h, idx) => header[idx] === h);
  if (!headerMatches) {
    throw new CsvContractError(
      'CSV_INVALID_HEADER',
      `CSV header must be: ${expected.join(',')}`
    );
  }

  const rows: CsvImportRow[] = [];
  const rowErrors: CsvRowParseError[] = [];
  let dataRowCount = 0;

  for (let i = headerIndex + 1; i < rawLines.length; i++) {
    const line = rawLines[i]!;
    if (line.trim().length === 0) {
      continue; // ignore blank rows
    }

    dataRowCount++;
    if (dataRowCount > CSV_MAX_ROWS) {
      throw new CsvContractError(
        'CSV_TOO_MANY_ROWS',
        `CSV exceeds the maximum of ${CSV_MAX_ROWS} data rows`
      );
    }

    const rowNumber = dataRowCount;
    const cells = splitCsvLine(line);
    const sku = cells[0] ?? '';
    const warehouseId = cells[1] ?? '';
    const onHandRaw = cells[2] ?? '';

    if (cells.length < 3 || sku.length === 0 || warehouseId.length === 0 || onHandRaw.length === 0) {
      rowErrors.push({
        rowNumber,
        sku,
        warehouseId,
        error: { code: 'INVALID_ROW', message: 'Row must have non-empty sku, warehouseId, onHand' },
      });
      continue;
    }

    // Integer-only; reject decimals and non-numeric.
    if (!/^-?\d+$/.test(onHandRaw)) {
      rowErrors.push({
        rowNumber,
        sku,
        warehouseId,
        error: { code: 'INVALID_QUANTITY', message: `onHand must be an integer: ${onHandRaw}` },
      });
      continue;
    }

    const onHand = Number(onHandRaw);
    if (onHand < 0) {
      rowErrors.push({
        rowNumber,
        sku,
        warehouseId,
        error: { code: 'NEGATIVE_QUANTITY', message: `onHand must be non-negative: ${onHandRaw}` },
      });
      continue;
    }

    rows.push({ rowNumber, sku, warehouseId, onHand });
  }

  return { rows, rowErrors };
}
