/**
 * Deterministic CSV serialization (RFC 4180).
 *
 * A field is quoted iff it contains the delimiter, a double quote, CR, or LF.
 * Embedded double quotes are doubled. Output uses CRLF line endings, which is
 * the most broadly compatible form for spreadsheet imports.
 *
 * Determinism (architecture §6.5): given the same rows and options, the output
 * is byte-identical. No locale, timezone, or ordering nondeterminism.
 */

export interface CsvOptions {
  delimiter?: string; // default ","
  /** Line ending. Default CRLF for maximum spreadsheet compatibility. */
  newline?: string; // default "\r\n"
  /** Always quote every field (some importers prefer this). Default false. */
  quoteAll?: boolean;
}

const DEFAULT_DELIMITER = ',';
const DEFAULT_NEWLINE = '\r\n';

function escapeField(value: string, delimiter: string, quoteAll: boolean): string {
  const mustQuote =
    quoteAll ||
    value.includes(delimiter) ||
    value.includes('"') ||
    value.includes('\n') ||
    value.includes('\r');
  if (!mustQuote) return value;
  return `"${value.replace(/"/g, '""')}"`;
}

/** Serialize a single row of string cells to a CSV line (no trailing newline). */
export function serializeRow(cells: ReadonlyArray<string>, options: CsvOptions = {}): string {
  const delimiter = options.delimiter ?? DEFAULT_DELIMITER;
  const quoteAll = options.quoteAll ?? false;
  return cells.map((c) => escapeField(c, delimiter, quoteAll)).join(delimiter);
}

/**
 * Serialize a header row + data rows to a complete CSV document.
 * `rows` are arrays aligned to `header`; missing cells must already be "".
 */
export function serializeCsv(
  header: ReadonlyArray<string>,
  rows: ReadonlyArray<ReadonlyArray<string>>,
  options: CsvOptions = {}
): string {
  const newline = options.newline ?? DEFAULT_NEWLINE;
  const lines = [serializeRow(header, options), ...rows.map((r) => serializeRow(r, options))];
  // Trailing newline after the final record (RFC 4180 permits; importers expect).
  return lines.join(newline) + newline;
}
