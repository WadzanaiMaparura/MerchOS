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

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import type { MarketplaceSchema } from '@merch-os/types';
import type {
  RawTakealotSchema,
  RawIndexEntry,
  RawCategoryRule,
} from './raw-schema.js';
import { toMarketplaceSchema } from './mapper.js';

interface SchemasBundle {
  index: RawIndexEntry[];
  schemas: Record<string, RawTakealotSchema>;
}

/**
 * The registry data lives in a single `schemas-bundle.json`. We read it lazily
 * with readFileSync rather than a static JSON import because the bundle is large
 * (~30MB) and a static import overwhelms some transform pipelines (e.g. vitest).
 *
 * Resolution order so this works in every consumer:
 *   1. SCHEMAS_BUNDLE_PATH env var (explicit override, e.g. Lambda).
 *   2. A `schemas-bundle.json` sitting next to the running module (how the CDK
 *      Lambda bundling copies it — see export-api-stack commandHooks).
 *   3. The package's generated/ directory (dev, tests, Node consumers).
 */
const __dirname = dirname(fileURLToPath(import.meta.url));
const BUNDLE_CANDIDATES = [
  process.env['SCHEMAS_BUNDLE_PATH'],
  join(__dirname, 'schemas-bundle.json'),
  join(__dirname, '..', 'generated', 'takealot-za', 'schemas-bundle.json'),
].filter((p): p is string => typeof p === 'string' && p.length > 0);

let cached: SchemasBundle | null = null;
function load(): SchemasBundle {
  if (cached) return cached;
  let lastErr: unknown;
  for (const candidate of BUNDLE_CANDIDATES) {
    try {
      cached = JSON.parse(readFileSync(candidate, 'utf8')) as SchemasBundle;
      return cached;
    } catch (e) {
      lastErr = e;
    }
  }
  throw new Error(
    `marketplace-schemas: could not load schemas-bundle.json from any of: ` +
      `${BUNDLE_CANDIDATES.join(', ')} (${String(lastErr)})`
  );
}

const data = new Proxy({} as SchemasBundle, {
  get(_t, prop: keyof SchemasBundle) {
    return load()[prop];
  },
});

/** List all available Takealot (ZA) loadsheet schemas (index view). */
export function listTakealotSchemas(): RawIndexEntry[] {
  return data.index;
}

/** Load the raw extracted schema for a given template id (e.g. "99"). */
export function getRawSchema(templateId: string): RawTakealotSchema | null {
  return data.schemas[String(templateId)] ?? null;
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
  for (const raw of Object.values(data.schemas)) {
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
  return data.index.map((e) => e.schemaFile);
}
