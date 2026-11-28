/**
 * RFC 4180 CSV reader. Used to re-read every generated file (and in tests) so
 * a broken quote or a wrong cell count is caught before a seller sees it.
 */

export function parseCsv(text: string, delimiter = ','): string[][] {
  const src = text.replace(/^\uFEFF/, '');
  const rows: string[][] = [];
  let row: string[] = [];
  let cell = '';
  let quoted = false;
  for (let i = 0; i < src.length; i++) {
    const ch = src[i]!;
    if (quoted) {
      if (ch === '"') {
        if (src[i + 1] === '"') {
          cell += '"';
          i++;
        } else {
          quoted = false;
        }
      } else {
        cell += ch;
      }
    } else if (ch === '"' && cell === '') {
      quoted = true;
    } else if (ch === delimiter) {
      row.push(cell);
      cell = '';
    } else if (ch === '\r' || ch === '\n') {
      if (ch === '\r' && src[i + 1] === '\n') i++;
      row.push(cell);
      rows.push(row);
      row = [];
      cell = '';
    } else {
      cell += ch;
    }
  }
  if (quoted) throw new Error('CSV has an unclosed quote');
  if (cell !== '' || row.length > 0) {
    row.push(cell);
    rows.push(row);
  }
  return rows;
}

/** Throws unless every row has exactly as many cells as the header. */
export function assertRectangular(rows: string[][]): void {
  const width = rows[0]?.length ?? 0;
  rows.forEach((r, i) => {
    if (r.length !== width) throw new Error(`CSV row ${i + 1} has ${r.length} cells; the header has ${width}`);
  });
}
