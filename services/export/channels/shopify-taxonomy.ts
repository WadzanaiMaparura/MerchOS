/**
 * Shopify Standard Product Taxonomy lookups (bundled released version).
 * A product's chosen Shopify category is stored as its id ("hg-11-10-5-5") and
 * written to the CSV as the full breadcrumb, which Shopify also accepts.
 */

import { SHOPIFY_TAXONOMY_TSV, SHOPIFY_TAXONOMY_VERSION } from './shopify-taxonomy.generated.js';

export { SHOPIFY_TAXONOMY_VERSION };

export interface ShopifyCategory {
  id: string;
  path: string;
}

let byId: Map<string, string> | null = null;
let all: ShopifyCategory[] | null = null;

function load(): void {
  if (byId) return;
  byId = new Map();
  all = [];
  for (const line of SHOPIFY_TAXONOMY_TSV.split('\n')) {
    const tab = line.indexOf('\t');
    if (tab <= 0) continue;
    const id = line.slice(0, tab);
    const path = line.slice(tab + 1);
    byId.set(id, path);
    all.push({ id, path });
  }
}

/** Full breadcrumb for an id, or undefined when it is not in the list. */
export function shopifyCategoryPath(id: string): string | undefined {
  load();
  return byId!.get(id.replace(/^gid:\/\/shopify\/TaxonomyCategory\//, ''));
}

/** Number of categories in the bundled list. */
export function shopifyCategoryCount(): number {
  load();
  return all!.length;
}

/**
 * Search by words ("mug", "t shirt"). Every word must appear in the path;
 * matches on the last part (the category itself) rank first, then shorter paths.
 */
export function searchShopifyCategories(query: string, limit = 20): ShopifyCategory[] {
  load();
  const raw = query.toLowerCase().split(/[^a-z0-9&]+/).filter(Boolean);
  const words = raw.filter((w) => w.length > 1);
  if (words.length === 0) return [];
  // Neighbouring words joined ("t shirts" -> "tshirts") find "T-Shirts".
  const joined = raw.slice(1).map((w, i) => raw[i] + w);
  const compact = (s: string) => s.replace(/[^a-z0-9&]+/g, '');
  const scored: Array<{ c: ShopifyCategory; score: number }> = [];
  // Every word must match; when nothing does ("coffee mug"), the best partial
  // matches are returned instead (most matching words first).
  const strict = all!.some((c) => words.every((w) => c.path.toLowerCase().includes(w)));
  for (const c of all!) {
    const p = c.path.toLowerCase();
    const hits = words.filter((w) => p.includes(w)).length;
    if (strict ? hits < words.length : hits === 0) continue;
    const leaf = p.slice(p.lastIndexOf('>') + 1);
    const leafHits = words.filter((w) => leaf.includes(w)).length + hits * 10;
    // The leaf IS the search: joined words ("t shirt") beat a single word ("shirt").
    const joinedExact = joined.some((j) => compact(leaf) === j || compact(leaf) === `${j}s`);
    const wordExact = words.some((w) => compact(leaf) === w || compact(leaf) === `${w}s`);
    // The last word is usually the thing itself ("coffee MUG").
    const last = words[words.length - 1]!;
    const lastBonus = compact(leaf).includes(last) ? 3000 : 0;
    scored.push({ c, score: leafHits * 1000 + lastBonus + (joinedExact ? 6000 : wordExact ? 5000 : 0) - c.path.length });
  }
  scored.sort((a, b) => b.score - a.score || a.c.path.localeCompare(b.c.path));
  return scored.slice(0, limit).map((s) => s.c);
}
