/**
 * Extract real product rows from the committed Takealot submission-results
 * workbooks into a JSON fixture used by the schema reconciliation test.
 *
 * Each results workbook has three outcome sheets:
 *   - "Rejected"              — prepended SystemValidation + RejectionReason cols
 *   - "New Products Created"  — accepted as new products
 *   - "Existing Products Added" — matched to existing catalogue products
 *
 * We capture, per data row (row 7+): its outcome, the two reason columns (when
 * present), the owning template id, and the field-id→value map. This is the
 * ground truth the reconciliation asserts our generated schemas agree with.
 *
 * Output: generated/takealot-za/_submission-fixtures.json
 */
import ExcelJS from 'exceljs';
import AdmZip from 'adm-zip';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const SRC = path.join(__dirname, '..', 'sources', 'takealot-za', 'submission-results');
const OUT = path.join(__dirname, '..', 'generated', 'takealot-za', '_submission-fixtures.json');

function sanitize(buf) {
  const zip = new AdmZip(buf);
  const out = new AdmZip();
  for (const e of zip.getEntries()) {
    const n = e.entryName;
    if (/^xl\/comments/i.test(n) || /commentsDrawing.*\.vml$/i.test(n)) continue;
    if (/^xl\/worksheets\/_rels\/.*\.rels$/i.test(n)) {
      let xml = zip.readAsText(e);
      xml = xml.replace(/<Relationship\b[^>]*Target="[^"]*(?:comment|commentsDrawing)[^"]*"[^>]*\/>/gi, '');
      out.addFile(n, Buffer.from(xml, 'utf8'));
      continue;
    }
    out.addFile(n, e.getData());
  }
  return out.toBuffer();
}
async function read(file) {
  const wb = new ExcelJS.Workbook();
  try { await wb.xlsx.readFile(file); return wb; }
  catch (e) { if (!/comments/i.test(String(e?.message))) throw e; await wb.xlsx.load(sanitize(fs.readFileSync(file))); return wb; }
}
function txt(cell) {
  const v = cell?.value;
  if (v == null) return null;
  if (typeof v === 'object') {
    if ('richText' in v) return v.richText.map((r) => r.text).join('');
    if ('result' in v) return v.result == null ? null : String(v.result);
    if ('text' in v) return v.text;
    return null;
  }
  return String(v);
}
function templateId(wb) {
  const d = (wb.model.definedNames || []).find((x) => x.name === 'LOADSHEET_TEMPLATE_ID');
  if (!d) return null;
  const m = /^'?([^'!]+)'?!\$?([A-Z]+)\$?(\d+)/.exec(d.ranges[0]);
  return m ? txt(wb.getWorksheet(m[1]).getCell(`${m[2]}${m[3]}`)) : null;
}

const OUTCOMES = {
  Rejected: 'rejected',
  'New Products Created': 'created',
  'Existing Products Added': 'existing',
};

async function extractFile(file) {
  const wb = await read(path.join(SRC, file));
  const tmpl = templateId(wb);
  const rows = [];
  for (const [sheetName, outcome] of Object.entries(OUTCOMES)) {
    const ws = wb.getWorksheet(sheetName);
    if (!ws) continue;
    const ids = {};
    for (let c = 1; c <= ws.columnCount; c++) {
      const t = txt(ws.getRow(1).getCell(c));
      if (t) ids[c] = t;
    }
    for (let r = 7; r <= ws.rowCount; r++) {
      const data = {};
      let systemValidation = null;
      let rejectionReason = null;
      let any = false;
      for (let c = 1; c <= ws.columnCount; c++) {
        const v = txt(ws.getRow(r).getCell(c));
        if (v == null || String(v).trim() === '') continue;
        const id = ids[c];
        if (id === 'SystemValidation') { systemValidation = v; continue; }
        if (id === 'RejectionReason') { rejectionReason = v; continue; }
        data[id || `col${c}`] = v;
        any = true;
      }
      if (!any) continue;
      rows.push({ outcome, systemValidation, rejectionReason, data });
    }
  }
  return { sourceFile: file, templateId: tmpl, rowCount: rows.length, rows };
}

async function main() {
  const files = fs.readdirSync(SRC).filter((f) => /\.xlsm$/i.test(f)).sort();
  const fixtures = [];
  for (const f of files) {
    const fx = await extractFile(f);
    fixtures.push(fx);
    const byOutcome = fx.rows.reduce((h, r) => ((h[r.outcome] = (h[r.outcome] || 0) + 1), h), {});
    console.log(`${f}  template=${fx.templateId}  rows=${fx.rowCount}  ${JSON.stringify(byOutcome)}`);
  }
  fs.writeFileSync(OUT, JSON.stringify(fixtures, null, 2));
  console.log(`\nWrote ${OUT}`);
}
main();
