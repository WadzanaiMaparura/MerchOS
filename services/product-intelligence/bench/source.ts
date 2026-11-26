/**
 * Turns a bench case's source into the ProductData the writing service gets,
 * exactly the way the product service does it for "Write my listing"
 * (mirrors buildProductData in services/product/api/handlers/synthesize-product.ts:
 * only non-empty values, attributes as strings, long text capped).
 *
 * CSV rows go through the same parser as supplier imports; saved product
 * pages through the same JSON-LD, OpenGraph and page-layout extractors.
 */

import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import * as cheerio from 'cheerio';
import { parseCsv } from '../../supplier-intelligence/processors/file-parser';
import {
  extractFromCssSelectors,
  extractFromJsonLd,
  extractFromOpenGraph,
} from '../../supplier-intelligence/processors/html-extractor';
import type { ProductData } from '../types/generation.types';
import type { BenchCase, CaseSource } from './types';

type Manual = Extract<CaseSource, { kind: 'manual' }>;
type Fields = { [K in keyof Omit<Manual, 'kind'>]?: Omit<Manual, 'kind'>[K] | undefined };

const text = (v: unknown, max: number): string | undefined =>
  typeof v === 'string' && v.trim() ? v.trim().slice(0, max) : undefined;

/** Same mapping as the product service (see header). */
export function toProductData(m: Fields): ProductData {
  const description = [text(m.description, 10000), text(m.shortDescription, 2000)]
    .filter(Boolean)
    .filter((v, i, all) => all.indexOf(v) === i)
    .join('\n\n');
  const attributes: Record<string, string> = {};
  for (const [k, v] of Object.entries(m.attributes ?? {})) {
    if (v === null || v === undefined || v === '') continue;
    if (['string', 'number', 'boolean'].includes(typeof v)) attributes[k] = String(v);
  }
  const data: ProductData = {};
  const name = text(m.title, 500);
  const brand = text(m.brand, 200);
  const category = text(m.category, 500);
  if (name) data.name = name;
  if (description) data.description = description;
  if (brand) data.brand = brand;
  if (category) data.category = category;
  if (Object.keys(attributes).length) data.attributes = attributes;
  const barcode = text(m.barcode, 14)?.replace(/\s+/g, '');
  if (barcode && /^\d{8}$|^\d{12,14}$/.test(barcode)) data.barcode = barcode;
  return data;
}

function fromCsv(caseFile: string, file: string, row: number): Fields {
  const parsed = parseCsv(readFileSync(resolve(dirname(caseFile), file)));
  const r = parsed.records[row - 1];
  if (!r) throw new Error(`Row ${row} not found in ${file} (${parsed.records.length} rows)`);
  return { title: r.title, description: r.description, brand: r.brand, category: r.category };
}

function fromHtml(caseFile: string, file: string, url: string): Fields {
  const $ = cheerio.load(readFileSync(resolve(dirname(caseFile), file), 'utf8'));
  const found = extractFromJsonLd($, url)[0] ?? extractFromOpenGraph($, url) ?? extractFromCssSelectors($, url)[0];
  if (!found) throw new Error(`No product found in ${file}`);
  return { title: found.title, description: found.description, brand: found.brand, category: found.category };
}

/** The product data for a case, and every word of source text (for the accuracy checks). */
export function loadSource(c: BenchCase, caseFile: string): { productData: ProductData; sourceText: string } {
  const s = c.source;
  const m = s.kind === 'manual' ? s : s.kind === 'csv' ? fromCsv(caseFile, s.file, s.row) : fromHtml(caseFile, s.file, s.url);
  const productData = toProductData(m);
  const sourceText = [
    productData.name,
    productData.description,
    productData.brand,
    productData.category,
    ...Object.entries(productData.attributes ?? {}).map(([k, v]) => `${k} ${v}`),
  ]
    .filter(Boolean)
    .join('\n');
  return { productData, sourceText };
}
