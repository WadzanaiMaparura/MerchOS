/**
 * Takealot loadsheet extractor.
 *
 * Reads each Takealot content loadsheet (.xlsm) under sources/takealot-za/ and
 * emits a precise MarketplaceSchema JSON per loadsheet under
 * generated/takealot-za/. Everything is extracted from the authoritative
 * workbook — no hand-written field mappings — so schemas stay exact and
 * re-generatable when Takealot revises the sheets.
 *
 * Authoritative signals (all read straight from the workbook):
 *   - Field order/metadata: the "Loadsheet" sheet header rows (1,3,4,5,6).
 *   - Allowed values (enums): `LOOKUP_*` defined names → referenced cells.
 *   - Per-category required/recommended attributes:
 *       `LOOKUP_NODEREQ_{nodeId}` / `LOOKUP_NODEREC_{nodeId}` defined names.
 *   - Core required flags: `REQUIRE_*` defined names (single flag cells).
 *   - Category tree: the "Category Tree Lookup" sheet.
 *
 * Why NOT `allowBlank`: Takealot sets data-validation allowBlank:false broadly
 * on validated cells, so it over-reports required. The NODEREQ/NODEREC ranges
 * are the real per-category requiredness signal and are what we use.
 *
 * Usage: node scripts/extract-takealot.mjs [loadsheet-99]  (omit to run all)
 */

import ExcelJS from 'exceljs';
import AdmZip from 'adm-zip';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const SRC_DIR = path.join(__dirname, '..', 'sources', 'takealot-za');
const OUT_DIR = path.join(__dirname, '..', 'generated', 'takealot-za');

const HEADER_ROWS = { fieldId: 1, label: 3, formatHint: 4, shortKey: 5, instructions: 6 };
const FIRST_DATA_ROW = 7;

// ---------------------------------------------------------------------------
// Low-level helpers
// ---------------------------------------------------------------------------

function cellText(cell) {
  const v = cell?.value;
  if (v == null) return null;
  if (typeof v === 'object') {
    if ('richText' in v) return v.richText.map((r) => r.text).join('');
    if ('result' in v) return v.result == null ? null : String(v.result);
    if ('text' in v) return v.text;
    if ('hyperlink' in v) return v.text ?? v.hyperlink;
    return null;
  }
  return String(v);
}

/** Strip Takealot's occasional wrapping quotes (e.g. '"Its Called Self Care"'). */
function clean(s) {
  if (s == null) return s;
  const t = String(s).trim();
  if (t.length >= 2 && t.startsWith('"') && t.endsWith('"')) return t.slice(1, -1).trim();
  return t;
}

/** Convert a spreadsheet column letter ("A", "AVF") to a 1-based index. */
function colToNum(col) {
  let n = 0;
  for (let i = 0; i < col.length; i++) n = n * 26 + (col.charCodeAt(i) - 64);
  return n;
}

/**
 * Resolve a defined name (single-column range) to its list of non-empty cell
 * values, in sheet order. Returns [] if the name is missing/unreadable.
 *
 * Results are memoised on a per-workbook cache (`wb.__nameCache`) because some
 * ranges (e.g. LOOKUP_Brands, ~39.5k rows) are expensive and may be referenced
 * more than once. Cells are read via numeric row/column indexing rather than
 * A1 string addresses, which is markedly faster over tens of thousands of rows.
 */
function resolveName(wb, byName, name) {
  const cache = (wb.__nameCache ??= new Map());
  if (cache.has(name)) return cache.get(name);

  const ranges = byName.get(name);
  const out = [];
  if (ranges) {
    for (const ref of ranges) {
      const m = /^'?([^'!]+)'?!\$?([A-Z]+)\$?(\d+)(?::\$?([A-Z]+)\$?(\d+))?$/.exec(ref);
      if (!m) continue;
      const [, sheetName, c1, r1, , r2] = m;
      const sheet = wb.getWorksheet(sheetName);
      if (!sheet) continue;
      const colNum = colToNum(c1);
      const rowEnd = r2 ? Number(r2) : Number(r1);
      for (let r = Number(r1); r <= rowEnd; r++) {
        const row = sheet.findRow(r);
        if (!row) continue; // sparse: no data in this row
        const t = clean(cellText(row.getCell(colNum)));
        if (t) out.push(t);
      }
    }
  }
  cache.set(name, out);
  return out;
}

/**
 * Some Takealot `.xlsm` files place cell comments at a non-standard zip path
 * (`xl/comments/comment1.xml`) that exceljs fails to reconcile, throwing
 * "Cannot read properties of undefined (reading 'comments')" during load.
 * Comments are annotations we never read for schema extraction, so we strip the
 * comment parts (and their worksheet relationships) and hand exceljs a clean
 * buffer. This is lossless for everything the schema cares about.
 */
function sanitizeXlsmBuffer(buf) {
  const zip = new AdmZip(buf);
  const out = new AdmZip();
  for (const entry of zip.getEntries()) {
    const name = entry.entryName;
    // Drop comment and legacy VML comment-drawing parts entirely.
    if (/^xl\/comments/i.test(name) || /commentsDrawing.*\.vml$/i.test(name)) continue;
    if (/^xl\/worksheets\/_rels\/.*\.rels$/i.test(name)) {
      // Remove relationship entries that point at comments / vml drawings.
      let xml = zip.readAsText(entry);
      xml = xml.replace(
        /<Relationship\b[^>]*Target="[^"]*(?:comment|commentsDrawing)[^"]*"[^>]*\/>/gi,
        ''
      );
      out.addFile(name, Buffer.from(xml, 'utf8'));
      continue;
    }
    out.addFile(name, entry.getData());
  }
  return out.toBuffer();
}

async function readWorkbook(file) {
  const wb = new ExcelJS.Workbook();
  try {
    await wb.xlsx.readFile(file);
    return wb;
  } catch (e) {
    if (!/comments/i.test(String(e?.message))) throw e;
    // Retry with comment parts stripped.
    const clean = sanitizeXlsmBuffer(fs.readFileSync(file));
    const wb2 = new ExcelJS.Workbook();
    await wb2.xlsx.load(clean);
    return wb2;
  }
}

function inferDataType(dv, hasEnum) {
  if (hasEnum) return 'enum';
  if (dv?.type === 'whole') return 'integer';
  if (dv?.type === 'decimal') return 'decimal';
  if (dv?.type === 'date') return 'date';
  return 'string';
}

function maxLengthFromDv(dv) {
  if (dv?.type === 'textLength' && Array.isArray(dv.formulae) && dv.formulae.length) {
    const n = Number(dv.formulae[0]);
    if (!Number.isNaN(n)) {
      // `lessThan` → strictly < n, so the max usable length is n - 1.
      return dv.operator === 'lessThan' ? n - 1 : n;
    }
  }
  return null;
}

function numericBoundsFromDv(dv) {
  if ((dv?.type === 'whole' || dv?.type === 'decimal') && Array.isArray(dv.formulae)) {
    const nums = dv.formulae.map((f) => Number(f)).filter((n) => !Number.isNaN(n));
    if (nums.length) {
      const b = {};
      if (dv.operator === 'between' && nums.length >= 2) {
        b.min = nums[0];
        b.max = nums[1];
      } else if (dv.operator === 'greaterThan') b.min = nums[0] + (dv.type === 'whole' ? 1 : 0);
      else if (dv.operator === 'greaterThanOrEqual') b.min = nums[0];
      else if (dv.operator === 'lessThan') b.max = nums[0] - (dv.type === 'whole' ? 1 : 0);
      else if (dv.operator === 'lessThanOrEqual') b.max = nums[0];
      return Object.keys(b).length ? b : null;
    }
  }
  return null;
}

// ---------------------------------------------------------------------------
// Category tree
// ---------------------------------------------------------------------------

/** Parse "Name (12345)" → { label:"Name", nodeId:"12345" } (nodeId may be null). */
function parseNode(s) {
  if (!s) return { label: null, nodeId: null };
  const m = /^(.*?)\s*\((\d+)\)\s*$/.exec(s.trim());
  if (m) return { label: m[1].trim(), nodeId: m[2] };
  return { label: s.trim(), nodeId: null };
}

function extractCategoryTree(wb) {
  const sheet = wb.getWorksheet('Category Tree Lookup');
  if (!sheet) return [];
  const tree = [];
  // Row 1-2 are titles, row 3 is the header ("Main Category" / "Lowest Category").
  for (let r = 4; r <= sheet.rowCount; r++) {
    const a = clean(cellText(sheet.getCell(`A${r}`)));
    const b = clean(cellText(sheet.getCell(`B${r}`)));
    if (!a && !b) continue;
    const main = parseNode(a);
    const leaf = parseNode(b); // b is a "Parent->Child (id)" path; id is the leaf node.
    tree.push({
      mainCategory: main.label,
      mainCategoryId: main.nodeId,
      leafPath: b,
      leafCategory: leaf.label,
      leafNodeId: leaf.nodeId,
    });
  }
  return tree;
}

// ---------------------------------------------------------------------------
// Per-loadsheet extraction
// ---------------------------------------------------------------------------

async function extractOne(file) {
  const wb = await readWorkbook(file);

  const ls = wb.getWorksheet('Loadsheet');
  if (!ls) throw new Error(`No "Loadsheet" sheet in ${path.basename(file)}`);

  const defined = wb.model.definedNames || [];
  const byName = new Map(defined.map((d) => [d.name, d.ranges]));

  const templateId = resolveName(wb, byName, 'LOADSHEET_TEMPLATE_ID')[0] ?? null;

  // --- Core REQUIRE_* flags (string "true"/"false"). ---
  const requireFlags = {};
  for (const d of defined) {
    if (/^REQUIRE_/.test(d.name)) {
      const val = resolveName(wb, byName, d.name)[0];
      requireFlags[d.name] = String(val).toLowerCase() === 'true';
    }
  }

  // --- Per-node required / recommended attribute sets. ---
  const categoryRules = {}; // nodeId -> { required:[], recommended:[] }
  const nodeIds = new Set();
  for (const d of defined) {
    let m = /^LOOKUP_NODEREQ_(\d+)$/.exec(d.name);
    if (m) {
      nodeIds.add(m[1]);
      (categoryRules[m[1]] ??= { required: [], recommended: [] }).required = resolveName(
        wb,
        byName,
        d.name
      );
      continue;
    }
    m = /^LOOKUP_NODEREC_(\d+)$/.exec(d.name);
    if (m) {
      nodeIds.add(m[1]);
      (categoryRules[m[1]] ??= { required: [], recommended: [] }).recommended = resolveName(
        wb,
        byName,
        d.name
      );
    }
  }

  // Fields required/recommended for EVERY node in this loadsheet (the universal
  // core for the categories this sheet covers). Intersection across all nodes.
  const nodeList = [...nodeIds];
  let baseRequired = null;
  let baseRecommended = null;
  for (const n of nodeList) {
    const req = new Set(categoryRules[n]?.required ?? []);
    const rec = new Set(categoryRules[n]?.recommended ?? []);
    baseRequired = baseRequired == null ? req : new Set([...baseRequired].filter((x) => req.has(x)));
    baseRecommended =
      baseRecommended == null ? rec : new Set([...baseRecommended].filter((x) => rec.has(x)));
  }
  baseRequired ??= new Set();
  baseRecommended ??= new Set();

  // Fields that are required for AT LEAST ONE node (conditionally required).
  const anyRequired = new Set();
  const anyRecommended = new Set();
  for (const n of nodeList) {
    for (const f of categoryRules[n]?.required ?? []) anyRequired.add(f);
    for (const f of categoryRules[n]?.recommended ?? []) anyRecommended.add(f);
  }

  // --- Walk Loadsheet columns in order. ---
  const fields = [];
  const columnOrder = [];
  for (let c = 1; c <= ls.columnCount; c++) {
    const fieldId = clean(cellText(ls.getRow(HEADER_ROWS.fieldId).getCell(c)));
    if (!fieldId) continue;

    const dv = ls.getRow(FIRST_DATA_ROW).getCell(c).dataValidation;
    let allowedValues = null;
    let allowedValuesSource = null;

    if (dv?.type === 'list' && dv.formulae?.length) {
      const formula = String(dv.formulae[0]).replace(/^=/, '');
      if (/^[A-Za-z_][A-Za-z0-9_]*$/.test(formula) && byName.has(formula)) {
        // Named range (static). Dynamic INDIRECT/VLOOKUP lists are recorded as a
        // source reference rather than materialised, because their values depend
        // on the chosen category at fill-in time.
        const vals = resolveName(wb, byName, formula);
        if (vals.length) {
          allowedValues = vals;
          allowedValuesSource = { kind: 'namedRange', name: formula };
        } else {
          allowedValuesSource = { kind: 'namedRange', name: formula, note: 'empty/unresolved' };
        }
      } else if (/^"[^"]*"$/.test(formula)) {
        // A genuine inline list is a single quoted, comma-separated literal
        // ("A,B,C"). Function calls (INDIRECT/VLOOKUP...) also contain commas
        // but are NOT inline lists — those fall through to `dynamic` below.
        allowedValues = formula.replace(/^"|"$/g, '').split(',').map((s) => clean(s)).filter(Boolean);
        allowedValuesSource = { kind: 'inline' };
      } else {
        // Formula-driven (category-dependent) list: record the dependency, do
        // not materialise values (they depend on the row's chosen category).
        allowedValuesSource = { kind: 'dynamic', formula };
      }
    }

    const hasEnum = Array.isArray(allowedValues) && allowedValues.length > 0;

    // Requiredness is a HYBRID signal:
    //  - Category attributes (Attribute.* / color.* / Variant.attribute.* /
    //    Images.*): driven by the per-node NODEREQ/NODEREC sets. For these,
    //    `allowBlank` is meaningless (Takealot sets it false on every validated
    //    attribute cell), so we ignore it.
    //  - Core structural fields (title, Category, Brand, ProductID.Value, ...):
    //    these are never listed in NODEREQ, so their requiredness comes from the
    //    cell's own `allowBlank:false` plus the REQUIRE_* flags.
    const isCategoryAttr = /^(Attribute\.|color\.|Variant\.|Images\.)/.test(fieldId);

    // Core fields whose submission-time requiredness is governed by an explicit
    // REQUIRE_* flag rather than by the cell's `allowBlank`. Reconciliation
    // against real accepted products shows `allowBlank:false` OVER-reports
    // required for these — Takealot accepts products with them blank when the
    // flag is false (e.g. no barcode → a Marketplace Product Label is assigned;
    // unknown brand → requested during review).
    const requireFlagKey = {
      SKU: 'REQUIRE_SKU',
      'ProductID.Value': 'REQUIRE_GTIN', // barcode / GTIN
      'CostPrice.Value': 'REQUIRE_COST_PRICE',
      'SuggestedPrice.Value': 'REQUIRE_SUGGESTED_PRICE',
      PackSize: 'REQUIRE_PACKSIZE',
    }[fieldId];

    // Core fields that Takealot treats as conditionally optional at submission
    // regardless of `allowBlank` (documented "may be left blank" behaviour, and
    // confirmed by accepted products that omit them).
    const CONDITIONALLY_OPTIONAL_CORE = new Set(['Brand']);

    let requiredForAll;
    let requiredForSome;
    if (isCategoryAttr) {
      requiredForAll = baseRequired.has(fieldId);
      requiredForSome = anyRequired.has(fieldId) && !baseRequired.has(fieldId);
    } else if (requireFlagKey) {
      // Governed solely by the REQUIRE_* flag (not allowBlank).
      requiredForAll = requireFlags[requireFlagKey] === true;
      requiredForSome = false;
    } else if (CONDITIONALLY_OPTIONAL_CORE.has(fieldId)) {
      requiredForAll = false;
      requiredForSome = false;
    } else {
      requiredForAll = dv?.allowBlank === false;
      requiredForSome = false;
    }

    const field = {
      fieldId,
      platformFieldName: fieldId,
      label: clean(cellText(ls.getRow(HEADER_ROWS.label).getCell(c))),
      shortKey: clean(cellText(ls.getRow(HEADER_ROWS.shortKey).getCell(c))),
      formatHint: clean(cellText(ls.getRow(HEADER_ROWS.formatHint).getCell(c))),
      instructions: clean(cellText(ls.getRow(HEADER_ROWS.instructions).getCell(c))),
      fieldClass: isCategoryAttr ? 'category-attribute' : 'core',
      requiredForAllCategories: requiredForAll,
      requiredForSomeCategories: requiredForSome,
      recommended: isCategoryAttr && (baseRecommended.has(fieldId) || anyRecommended.has(fieldId)),
      maxLength: maxLengthFromDv(dv),
      numericBounds: numericBoundsFromDv(dv),
      dataType: inferDataType(dv, hasEnum),
      allowedValues: hasEnum ? allowedValues : null,
      allowedValuesSource,
      columnIndex: c,
    };
    fields.push(field);
    columnOrder.push(fieldId);
  }

  // Is requiredness uniform across every node in this loadsheet?
  const requiredUniform = nodeList.every((n) => {
    const req = new Set(categoryRules[n]?.required ?? []);
    return req.size === baseRequired.size && [...baseRequired].every((x) => req.has(x));
  });

  const categoryTree = extractCategoryTree(wb);

  return {
    platform: 'takealot',
    country: 'ZA',
    templateId,
    sourceFile: path.basename(file),
    exportFormat: 'XLSX',
    delimiter: ',',
    encoding: 'utf-8',
    extractedAt: new Date().toISOString(),
    requireFlags,
    fieldCount: fields.length,
    categoryNodeCount: nodeList.length,
    categoryTreeCount: categoryTree.length,
    requiredUniformAcrossNodes: requiredUniform,
    baseRequiredFields: [...baseRequired],
    columnOrder,
    fields,
    categoryTree,
    categoryRules,
  };
}

// ---------------------------------------------------------------------------
// Runner
// ---------------------------------------------------------------------------

async function main() {
  fs.mkdirSync(OUT_DIR, { recursive: true });
  const arg = process.argv[2];
  const files = fs
    .readdirSync(SRC_DIR)
    .filter((f) => /^loadsheet-\d+\.xlsm$/.test(f))
    .filter((f) => (arg ? f === `${arg}.xlsm` || f === arg : true))
    .sort();

  if (!files.length) {
    console.error(`No matching loadsheets in ${SRC_DIR}` + (arg ? ` for "${arg}"` : ''));
    process.exit(1);
  }

  const index = [];
  const indexPath = path.join(OUT_DIR, '_index.json');
  for (const f of files) {
    const full = path.join(SRC_DIR, f);
    try {
      const schema = await extractOne(full);
      const outName = `${path.basename(f, '.xlsm')}.json`;
      fs.writeFileSync(path.join(OUT_DIR, outName), JSON.stringify(schema, null, 2));
      const reqAll = schema.fields.filter((x) => x.requiredForAllCategories).length;
      const reqSome = schema.fields.filter((x) => x.requiredForSomeCategories).length;
      const enums = schema.fields.filter((x) => x.dataType === 'enum').length;
      console.log(
        `${f}  template=${schema.templateId}  fields=${schema.fieldCount}  ` +
          `reqAll=${reqAll} reqSome=${reqSome} enums=${enums}  ` +
          `nodes=${schema.categoryNodeCount} cats=${schema.categoryTreeCount} ` +
          `uniform=${schema.requiredUniformAcrossNodes}`
      );
      index.push({
        templateId: schema.templateId,
        sourceFile: f,
        schemaFile: outName,
        fieldCount: schema.fieldCount,
        categoryNodeCount: schema.categoryNodeCount,
        categoryTreeCount: schema.categoryTreeCount,
      });
      // Write the index after every file so a partial/interrupted run still
      // leaves a valid, consistent index for whatever was produced.
      fs.writeFileSync(indexPath, JSON.stringify(index, null, 2));
    } catch (e) {
      console.error(`FAILED ${f}: ${e.message}`);
    }
  }
  console.log(`\nWrote ${index.length} schema file(s) + _index.json to generated/takealot-za/`);
}

main();
