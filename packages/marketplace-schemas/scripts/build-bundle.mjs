/**
 * Assemble the generated per-loadsheet schema JSON into a single
 * `schemas-bundle.json` that the registry imports statically.
 *
 * Why: the registry must work inside a bundled Lambda (esbuild). esbuild inlines
 * a static JSON import but does NOT package files read at runtime via
 * readFileSync. A single statically-imported bundle makes the package
 * self-contained and bundler-agnostic — no runtime file I/O, no __dirname.
 *
 * Fast + idempotent: reads the already-extracted JSON (no .xlsm parsing), so it
 * can run after `extract:takealot` or on its own.
 *
 * Output: generated/takealot-za/schemas-bundle.json
 *   { index: RawIndexEntry[], schemas: { [templateId]: RawTakealotSchema } }
 */
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const OUT_DIR = path.join(__dirname, '..', 'generated', 'takealot-za');

function main() {
  const indexPath = path.join(OUT_DIR, '_index.json');
  if (!fs.existsSync(indexPath)) {
    console.error('No _index.json found — run extract:takealot first.');
    process.exit(1);
  }
  const index = JSON.parse(fs.readFileSync(indexPath, 'utf8'));
  const schemas = {};
  for (const entry of index) {
    const schema = JSON.parse(fs.readFileSync(path.join(OUT_DIR, entry.schemaFile), 'utf8'));
    schemas[String(schema.templateId)] = schema;
  }
  const bundle = { index, schemas };
  const bundlePath = path.join(OUT_DIR, 'schemas-bundle.json');
  fs.writeFileSync(bundlePath, JSON.stringify(bundle));
  const kb = Math.round(fs.statSync(bundlePath).size / 1024);
  console.log(`Wrote schemas-bundle.json: ${index.length} schemas, ${kb} KB`);
}

main();
