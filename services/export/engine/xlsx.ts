/**
 * Deterministic XLSX serialization.
 *
 * Takealot product-creation loadsheets are XLSX. We generate a single-sheet
 * workbook ("Loadsheet") with a header row followed by data rows, matching the
 * schema's column order.
 *
 * Determinism (architecture §6.5): exceljs stamps workbook created/modified
 * dates by default, which would make output non-reproducible. We pin both to a
 * fixed epoch so the same input yields a byte-identical buffer.
 */

import ExcelJS from 'exceljs';

/** Fixed timestamp so workbook metadata never introduces nondeterminism. */
const FIXED_EPOCH = new Date('2000-01-01T00:00:00.000Z');

export interface XlsxOptions {
  sheetName?: string; // default "Loadsheet"
}

/**
 * Build an XLSX workbook buffer from a header row and string data rows.
 * Cells are written as strings (loadsheet values are text/number-as-text).
 */
export async function serializeXlsx(
  header: ReadonlyArray<string>,
  rows: ReadonlyArray<ReadonlyArray<string>>,
  options: XlsxOptions = {}
): Promise<Buffer> {
  const wb = new ExcelJS.Workbook();
  // Pin metadata for determinism.
  wb.created = FIXED_EPOCH;
  wb.modified = FIXED_EPOCH;
  wb.creator = 'MerchOS';
  wb.lastModifiedBy = 'MerchOS';

  const sheet = wb.addWorksheet(options.sheetName ?? 'Loadsheet');
  sheet.addRow([...header]);
  for (const row of rows) sheet.addRow([...row]);

  const out = await wb.xlsx.writeBuffer();
  return Buffer.from(out);
}
