/**
 * Quality test bench: shared types.
 *
 * A "case" is one real product with its source (what a seller would give us)
 * and, optionally, what we expect (facts that must be right, the category, the
 * attributes a marketplace requires) and a "gold" listing to compare against.
 */

import type { MarketplaceId, ProductData } from '../types/generation.types';

/** Where the product information comes from, in the same forms sellers use. */
export type CaseSource =
  /** Typed in, like the "Add product" form. */
  | {
      kind: 'manual';
      title?: string;
      description?: string;
      shortDescription?: string;
      brand?: string;
      category?: string;
      attributes?: Record<string, string | number | boolean>;
      barcode?: string;
    }
  /** One row of a supplier CSV file (path relative to the case file). */
  | { kind: 'csv'; file: string; row: number }
  /** A saved supplier product page (path relative to the case file). */
  | { kind: 'html'; file: string; url: string };

export interface BenchCase {
  id: string;
  /** Shown in the scorecard. */
  label: string;
  /** Free text, e.g. "home", "electronics" (scorecard groups by it). */
  group?: string;
  marketplace?: MarketplaceId;
  source: CaseSource;
  expect?: {
    /** Words the top category must contain (any one), e.g. ["Mugs", "Drinkware"]. */
    category?: string[];
    /** Attribute names the listing must have, e.g. ["Material", "Capacity"]. */
    requiredAttributes?: string[];
    /** Facts that must appear correctly somewhere in the listing, e.g. "350 ml". */
    facts?: string[];
    /** Things that must never be claimed, e.g. "dishwasher safe". */
    mustNotSay?: string[];
  };
  /** A listing you consider excellent, for side-by-side comparison. */
  gold?: { title?: string; bullets?: string[]; description?: string };
  /** Sample cases shipped with the bench (replace with real products). */
  example?: boolean;
}

/** What the pipeline produced for one case. */
export interface BenchOutput {
  caseId: string;
  productData: ProductData;
  title?: string;
  description?: string;
  bullets?: string[];
  attributes?: Array<{ key: string; value: string; confidence: number }>;
  categories?: Array<{ path: string[]; confidence: number }>;
  /** Steps that failed, with the reason (nothing is scored for them). */
  errors: Array<{ step: string; message: string }>;
  modelIds: string[];
  latencyMs: number;
}

export type Area = 'accuracy' | 'completeness' | 'rules' | 'category' | 'language';

export interface CheckFinding {
  area: Area;
  level: 'fail' | 'warn';
  /** Plain words: what is wrong and where. */
  message: string;
}

export interface CaseScore {
  caseId: string;
  /** 0-100. */
  score: number;
  byArea: Record<Area, number | null>;
  findings: CheckFinding[];
}

/** One human verdict from review.csv. */
export interface Review {
  caseId: string;
  verdict: 'good' | 'fix' | 'bad';
  note?: string;
}
