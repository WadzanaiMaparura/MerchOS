/**
 * Takealot (ZA) Schema Registry.
 *
 * Loads the generated loadsheet schemas (JSON extracted from the authoritative
 * `.xlsm` templates) and exposes the registry operations described in
 * docs/architecture/schema-validation-architecture.md §3.6: Lookup, List, and
 * access to per-category required/recommended rules.
 *
 * Schemas are loaded lazily and cached. The generated JSON is the single source
 * of truth — this module performs no hand-mapping of fields.
 */

import { createRequire } from 'node:module';
import { readFileSync, readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import type { MarketplaceSchema } from '@merch-os/types';
import type {
  RawTakealotSchema,
  RawIndexEntry,
  RawCategoryRule,
} from './raw-schema.js';
import { toMarketplaceSchema } from './mapper.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const GENERATED_DIR = join(__dirname, '..', 'generated', 'takealot-za');

let indexCache: RawIndexEntry[] | null = null;
const rawCache = new Map<string, RawTakealotSchema>();

function loadIndex(): RawIndexEntry[] {
  if (indexCache) return indexCache;
  const text = readFileSync(join(GENERATED_DIR, '_index.json'), 'utf8');
  indexCache = JSON.parse(text) as RawIndexEntry[];
  return indexCache;
}

function loadRawByFile(schemaFile: string): RawTakealotSchema {
  const cached = rawCache.get(schemaFile);
  if (cached) return cached;
  const text = readFileSync(join(GENERATED_DIR, schemaFile), 'utf8');
  const raw = JSON.parse(text) as RawTakealotSchema;
  rawCache.set(schemaFile, raw);
  return raw;
}

/** List all available Takealot (ZA) loadsheet schemas (index view). */
export function listTakealotSchemas(): RawIndexEntry[] {
  return loadIndex();
}

/** Load the raw extracted schema for a given template id (e.g. "99"). */
export function getRawSchema(templateId: string): RawTakealotSchema | null {
  const entry = loadIndex().find((e) => String(e.templateId) === String(templateId));
  if (!entry) return null;
  return loadRawByFile(entry.schemaFile);
}

/** Lookup a canonical `MarketplaceSchema` by Takealot template id. */
export function getSchema(templateId: string): MarketplaceSchema | null {
  const raw = getRawSchema(templateId);
  return raw ? toMarketplaceSchema(raw) : null;
}

/**
 * Find the loadsheet template id that owns a given Takealot leaf category node.
 * Returns null if no loaded loadsheet covers that node.
 */
export function findTemplateForCategoryNode(nodeId: string): string | null {
  for (const entry of loadIndex()) {
    const raw = loadRawByFile(entry.schemaFile);
    if (raw.categoryRules[nodeId] || raw.categoryTree.some((c) => c.leafNodeId === nodeId)) {
      return String(raw.templateId);
    }
  }
  return null;
}

/**
 * Get the required/recommended attribute sets for a specific leaf category node
 * within a loadsheet. This is the precise, category-aware requiredness the
 * Validation Engine needs (NODEREQ/NODEREC), beyond the schema-wide view.
 */
export function getCategoryRule(
  templateId: string,
  nodeId: string
): RawCategoryRule | null {
  const raw = getRawSchema(templateId);
  return raw?.categoryRules[nodeId] ?? null;
}

/** Enumerate all available generated schema files (for tooling/diagnostics). */
export function listGeneratedFiles(): string[] {
  return readdirSync(GENERATED_DIR).filter((f) => /^loadsheet-\d+\.json$/.test(f));
}

// Keep a require handle available for CJS consumers / tooling that prefer it.
export const _require = createRequire(import.meta.url);
