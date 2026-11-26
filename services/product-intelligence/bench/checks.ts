/**
 * Quality checks for one generated listing. Plain code, no model calls (the
 * optional model cross-check is judge.ts), so they are fast, free and repeatable.
 *
 *   accuracy      every number with a unit (350 ml, 2.4 GHz, 1.5 m) must be in the
 *                 source; risky claims (waterproof, dishwasher safe, warranty...)
 *                 must be in the source; expected facts present; "must not say" absent
 *   completeness  title, description (enough words), bullets, attributes; the
 *                 attributes the case says the marketplace requires
 *   rules         marketplace limits and characters (the same marketplaceAdapter
 *                 the service uses), restricted terms, no prices, links, phone
 *                 numbers, emails, shouting or leftover formatting
 *   category      the top suggestion contains the expected words (top 3: warning)
 *   language      South African / British spelling, repetition, duplicate bullets,
 *                 stock phrases that make a listing sound machine-written
 */

import { KNOWN_RESTRICTED_TERMS } from '../services/compliance-validator';
import { marketplaceAdapter } from '../services/marketplace-adapter';
import type { MarketplaceId } from '../types/generation.types';
import type { Area, BenchCase, BenchOutput, CaseScore, CheckFinding } from './types';

/** How much each area counts towards the 0-100 score. Accuracy matters most. */
export const WEIGHTS: Record<Area, number> = { accuracy: 35, completeness: 20, rules: 20, category: 10, language: 15 };
/** Any accuracy failure caps the score: a wrong fact is never a good listing. */
export const ACCURACY_FAIL_CAP = 50;
export const MIN_DESCRIPTION_WORDS = 80;
export const TARGET_BULLETS = 5;
export const MIN_ATTRIBUTES = 3;

const lc = (s: string) => s.toLowerCase();
const squash = (s: string) => lc(s).replace(/\s+/g, '').replace(/,/g, '.');

// ─── Accuracy ────────────────────────────────────────────────────────────────

const UNITS =
  'mm|cm|m|km|in|inch|inches|ft|ml|l|litres?|liters?|g|kg|mg|oz|lb|lbs|w|kw|v|mah|ah|hz|khz|mhz|ghz|gb|tb|mb|mp|fps|db|°c|c|pcs|pieces|pack|piece|year|years|month|months|hours|hrs|h|min|minutes|%|x';
const MEASURE = new RegExp(`(\\d+(?:[.,]\\d+)?)\\s?(${UNITS})\\b`, 'gi');

/** "350 ml", "2,4GHz", "12 x" in the text, normalised ("350ml", "2.4ghz"). */
export function measurements(text: string): string[] {
  const out = new Set<string>();
  for (const m of text.matchAll(MEASURE)) out.add(`${m[1]!.replace(',', '.')}${lc(m[2]!)}`.replace(/litres?|liters?/, 'l'));
  return [...out];
}

/** Claims that cause returns or marketplace penalties when they are not true. */
export const RISKY_CLAIMS = [
  'waterproof', 'water resistant', 'water-resistant', 'dishwasher safe', 'microwave safe', 'oven safe', 'freezer safe',
  'bpa free', 'bpa-free', 'organic', 'hypoallergenic', 'non-toxic', 'food grade', 'food-grade', 'handmade', 'hand made',
  'warranty', 'guarantee', 'certified', 'genuine leather', 'real leather', 'stainless steel', 'solid wood', '100%',
  'eco-friendly', 'biodegradable', 'vegan', 'cruelty free', 'cruelty-free', 'fda', 'sabs', 'dermatologically tested',
  'shatterproof', 'unbreakable', 'rechargeable', 'wireless', 'bluetooth', 'usb-c', '4k', 'hd',
];

function outputText(o: BenchOutput): string {
  return [o.title, ...(o.bullets ?? []), o.description, ...(o.attributes ?? []).map((a) => `${a.key} ${a.value}`)]
    .filter(Boolean)
    .join('\n');
}

/** Unit -> [base unit, factor], so "15.6 inch" and "39.62 cm" are the same length. */
const CONVERT: Record<string, [string, number]> = {
  mm: ['m', 0.001], cm: ['m', 0.01], m: ['m', 1], km: ['m', 1000], in: ['m', 0.0254], inch: ['m', 0.0254], inches: ['m', 0.0254], ft: ['m', 0.3048],
  ml: ['l', 0.001], l: ['l', 1], g: ['kg', 0.001], kg: ['kg', 1], mg: ['kg', 1e-6], oz: ['kg', 0.0283495], lb: ['kg', 0.453592], lbs: ['kg', 0.453592],
  w: ['w', 1], kw: ['w', 1000], hz: ['hz', 1], khz: ['hz', 1e3], mhz: ['hz', 1e6], ghz: ['hz', 1e9], mb: ['b', 1e6], gb: ['b', 1e9], tb: ['b', 1e12],
};
const splitMeasure = (m: string): [number, string] => {
  const x = /^(\d+(?:\.\d+)?)(.+)$/.exec(m)!;
  return [Number(x[1]), x[2]!];
};
/** In the source exactly, or a correct conversion of something in the source (within 1%). */
export function supported(m: string, sourceMeasures: string[]): boolean {
  if (sourceMeasures.includes(m)) return true;
  const [v, u] = splitMeasure(m);
  const conv = CONVERT[u];
  if (!conv) return false;
  return sourceMeasures.some((s) => {
    const [sv, su] = splitMeasure(s);
    const sc = CONVERT[su];
    return !!sc && sc[0] === conv[0] && Math.abs(v * conv[1] - sv * sc[1]) <= 0.01 * sv * sc[1];
  });
}

function accuracy(c: BenchCase, o: BenchOutput, source: string): CheckFinding[] {
  const f: CheckFinding[] = [];
  const out = outputText(o);
  // Exact values, not substrings: "7 l" must not pass because the source says "1.7 l".
  const sourceMeasures = measurements(source);
  for (const m of measurements(out)) {
    if (!supported(m, sourceMeasures)) f.push({ area: 'accuracy', level: 'fail', message: `"${m}" is not in the product information (invented or changed)` });
  }
  const srcLc = lc(source);
  for (const claim of RISKY_CLAIMS) {
    if (new RegExp(`\\b${claim.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\b`, 'i').test(out) && !srcLc.includes(claim)) {
      f.push({ area: 'accuracy', level: 'fail', message: `Says "${claim}" but the product information does not` });
    }
  }
  if (c.source.kind === 'manual' && c.source.brand && o.title && !lc(o.title).includes(lc(c.source.brand))) {
    f.push({ area: 'accuracy', level: 'warn', message: `Title does not name the brand (${c.source.brand})` });
  }
  for (const fact of c.expect?.facts ?? []) {
    if (!squash(out).includes(squash(fact))) f.push({ area: 'accuracy', level: 'fail', message: `Missing or wrong: "${fact}"` });
  }
  for (const bad of c.expect?.mustNotSay ?? []) {
    if (lc(out).includes(lc(bad))) f.push({ area: 'accuracy', level: 'fail', message: `Says "${bad}", which must never be claimed for this product` });
  }
  return f;
}

// ─── Completeness ────────────────────────────────────────────────────────────

const words = (s: string | undefined) => (s ?? '').trim().split(/\s+/).filter(Boolean).length;

function completeness(c: BenchCase, o: BenchOutput): CheckFinding[] {
  const f: CheckFinding[] = [];
  const area = 'completeness' as const;
  if (!o.title) f.push({ area, level: 'fail', message: 'No title' });
  if (!o.description) f.push({ area, level: 'fail', message: 'No description' });
  else if (words(o.description) < MIN_DESCRIPTION_WORDS) {
    f.push({ area, level: 'warn', message: `Description is short (${words(o.description)} words, aim for ${MIN_DESCRIPTION_WORDS}+)` });
  }
  const bullets = o.bullets?.length ?? 0;
  if (bullets === 0) f.push({ area, level: 'fail', message: 'No bullet points' });
  else if (bullets < TARGET_BULLETS) f.push({ area, level: 'warn', message: `Only ${bullets} bullet points (aim for ${TARGET_BULLETS})` });
  const attrs = o.attributes ?? [];
  if (attrs.length < MIN_ATTRIBUTES) f.push({ area, level: 'warn', message: `Only ${attrs.length} attributes found` });
  const have = new Set(attrs.map((a) => lc(a.key).replace(/[\s_-]/g, '')));
  for (const req of c.expect?.requiredAttributes ?? []) {
    if (!have.has(lc(req).replace(/[\s_-]/g, ''))) f.push({ area, level: 'fail', message: `Required attribute missing: ${req}` });
  }
  return f;
}

// ─── Marketplace rules ───────────────────────────────────────────────────────

const PRICE = /\bR\s?\d[\d\s,.]*\b|\bZAR\s?\d/;
const LINK = /https?:\/\/|www\.|\.co\.za\b|\.com\b/i;
const EMAIL = /[\w.+-]+@[\w-]+\.[\w.]+/;
const PHONE = /(\+27|\b0)\s?\d{2}[\s-]?\d{3}[\s-]?\d{4}\b/;
const PROMO = /\b(free shipping|free delivery|on sale|sale now|discount|limited time|buy now|best price|cheapest)\b/i;
const MARKDOWN = /\*\*|__|^#{1,6}\s|^\s*[-*•]\s/m;

function rules(o: BenchOutput, marketplace: MarketplaceId): CheckFinding[] {
  const f: CheckFinding[] = [];
  const area = 'rules' as const;
  const parts: Array<[string, string | undefined, 'title' | 'description' | 'bullets']> = [
    ['Title', o.title, 'title'],
    ['Description', o.description, 'description'],
    ...(o.bullets ?? []).map((b, i) => [`Bullet ${i + 1}`, b, 'bullets'] as [string, string, 'bullets']),
  ];
  for (const [label, value, type] of parts) {
    if (!value) continue;
    const adapted = marketplaceAdapter.apply(value, marketplace, type);
    for (const w of adapted.warnings) f.push({ area, level: adapted.complianceStatus === 'non_compliant' ? 'fail' : 'warn', message: `${label}: ${w}` });
    if (PRICE.test(value)) f.push({ area, level: 'fail', message: `${label} mentions a price` });
    if (LINK.test(value) || EMAIL.test(value) || PHONE.test(value)) f.push({ area, level: 'fail', message: `${label} has a link, email or phone number` });
    if (PROMO.test(value)) f.push({ area, level: 'warn', message: `${label} uses sales wording ("${value.match(PROMO)![0]}")` });
    if (MARKDOWN.test(value)) f.push({ area, level: 'warn', message: `${label} has leftover formatting (*, #, list markers)` });
    const shout = value.match(/\b[A-Z]{5,}\b/g)?.filter((wd) => !/^(USB|LED|HDMI|BPA)/.test(wd));
    if (shout?.length) f.push({ area, level: 'warn', message: `${label} uses capitals for emphasis (${shout.slice(0, 3).join(', ')})` });
  }
  const all = lc([o.title, o.description, ...(o.bullets ?? [])].filter(Boolean).join(' '));
  for (const t of KNOWN_RESTRICTED_TERMS) {
    // Whole words only ("cure" must not match "secure").
    const word = new RegExp(`(^|[^\\p{L}\\p{N}])${lc(t.term).replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}($|[^\\p{L}\\p{N}])`, 'u');
    if (t.marketplaces.includes(marketplace) && word.test(all)) {
      f.push({ area, level: t.severity === 'error' ? 'fail' : 'warn', message: `Restricted term "${t.term}" (${t.suggestedFix})` });
    }
  }
  if (o.title && /[.!?,;:]$/.test(o.title.trim())) f.push({ area, level: 'warn', message: 'Title ends with punctuation' });
  return f;
}

// ─── Category ────────────────────────────────────────────────────────────────

function category(c: BenchCase, o: BenchOutput): CheckFinding[] | null {
  const want = c.expect?.category;
  if (!want?.length) return null;
  const preds = o.categories ?? [];
  const hit = (p: { path: string[] }) => want.some((w) => lc(p.path.join(' > ')).includes(lc(w)));
  if (preds[0] && hit(preds[0])) return [];
  if (preds.slice(1, 3).some(hit)) return [{ area: 'category', level: 'warn', message: `Right category only as 2nd/3rd choice (top: ${preds[0]?.path.join(' > ')})` }];
  return [{ area: 'category', level: 'fail', message: `Wrong category: ${preds[0]?.path.join(' > ') ?? 'none'} (expected ${want.join(' or ')})` }];
}

// ─── Language ────────────────────────────────────────────────────────────────

/** US spelling -> South African / British. */
export const US_SPELLINGS: Record<string, string> = {
  color: 'colour', colors: 'colours', colorful: 'colourful', flavor: 'flavour', flavors: 'flavours', favorite: 'favourite',
  center: 'centre', centers: 'centres', meter: 'metre', meters: 'metres', liter: 'litre', liters: 'litres',
  aluminum: 'aluminium', gray: 'grey', fiber: 'fibre', jewelry: 'jewellery', cozy: 'cosy', mold: 'mould',
  organize: 'organise', organizer: 'organiser', organized: 'organised', personalized: 'personalised', customize: 'customise',
  optimized: 'optimised', durable: 'durable', defense: 'defence', license: 'licence', catalog: 'catalogue',
  tire: 'tyre', tires: 'tyres', pajamas: 'pyjamas', practise: 'practise', travelers: 'travellers', traveler: 'traveller',
};
/** Stock phrases that make copy sound machine-written. */
export const STOCK_PHRASES = [
  'elevate your', 'unleash', 'game-changer', 'game changer', 'look no further', 'whether you\'re', 'whether you are',
  'seamless', 'seamlessly', 'delve', 'in today\'s fast-paced', 'take your', 'to the next level', 'must-have', 'perfect for anyone',
  'say goodbye to', 'revolutionary', 'cutting-edge', 'state-of-the-art', 'unparalleled', 'second to none', 'experience the',
  'artificial intelligence', ' ai ',
];

function language(o: BenchOutput, source: string): CheckFinding[] {
  const f: CheckFinding[] = [];
  const area = 'language' as const;
  const text = [o.title, o.description, ...(o.bullets ?? [])].filter(Boolean).join('\n');
  const srcLc = lc(source);
  for (const [us, sa] of Object.entries(US_SPELLINGS)) {
    if (us === sa) continue;
    if (new RegExp(`\\b${us}\\b`, 'i').test(text) && !new RegExp(`\\b${us}\\b`, 'i').test(srcLc)) {
      f.push({ area, level: 'warn', message: `US spelling "${us}" (use "${sa}")` });
    }
  }
  const padded = ` ${lc(text).replace(/\s+/g, ' ')} `;
  const stock = STOCK_PHRASES.filter((p) => padded.includes(p));
  if (stock.length) f.push({ area, level: stock.length >= 3 ? 'fail' : 'warn', message: `Sounds machine-written: ${stock.map((s) => `"${s.trim()}"`).join(', ')}` });
  const bullets = (o.bullets ?? []).map((b) => lc(b).replace(/\W+/g, ' ').trim());
  if (new Set(bullets).size < bullets.length) f.push({ area, level: 'fail', message: 'Two bullet points say the same thing' });
  const tri = new Map<string, number>();
  const w = lc(text).replace(/[^\p{L}\p{N}\s]/gu, ' ').split(/\s+/).filter(Boolean);
  for (let i = 0; i + 2 < w.length; i++) {
    // Repeating a spec ("15.6 inch") is normal; repeating wording is not.
    if (/\d/.test(`${w[i]}${w[i + 1]}${w[i + 2]}`)) continue;
    const k = `${w[i]} ${w[i + 1]} ${w[i + 2]}`;
    tri.set(k, (tri.get(k) ?? 0) + 1);
  }
  const repeated = [...tri].filter(([, n]) => n >= 3).map(([k]) => k);
  if (repeated.length) f.push({ area, level: 'warn', message: `Repeats itself ("${repeated[0]}" ${tri.get(repeated[0]!)} times)` });
  return f;
}

// ─── Score ───────────────────────────────────────────────────────────────────

/** 100 with nothing found; each failure costs 50, each warning 15 (never below 0). */
function areaScore(findings: CheckFinding[]): number {
  return Math.max(0, 100 - findings.reduce((s, x) => s + (x.level === 'fail' ? 50 : 15), 0));
}

export function scoreCase(c: BenchCase, o: BenchOutput, sourceText: string, extra: CheckFinding[] = []): CaseScore {
  const marketplace = c.marketplace ?? 'takealot';
  const cat = category(c, o);
  const all: Record<Area, CheckFinding[] | null> = {
    accuracy: [...accuracy(c, o, sourceText), ...extra.filter((e) => e.area === 'accuracy')],
    completeness: completeness(c, o),
    rules: rules(o, marketplace),
    category: cat,
    language: language(o, sourceText),
  };
  for (const e of o.errors) (all.completeness ??= []).push({ area: 'completeness', level: 'fail', message: `${e.step} failed: ${e.message}` });

  const byArea = Object.fromEntries(
    (Object.keys(all) as Area[]).map((a) => [a, all[a] === null ? null : areaScore(all[a]!)]),
  ) as Record<Area, number | null>;
  const scored = (Object.keys(byArea) as Area[]).filter((a) => byArea[a] !== null);
  const totalWeight = scored.reduce((s, a) => s + WEIGHTS[a], 0);
  let score = Math.round(scored.reduce((s, a) => s + (byArea[a]! * WEIGHTS[a]) / totalWeight, 0));
  const findings = (Object.values(all).filter(Boolean) as CheckFinding[][]).flat();
  if (findings.some((x) => x.area === 'accuracy' && x.level === 'fail')) score = Math.min(score, ACCURACY_FAIL_CAP);
  return { caseId: c.id, score, byArea, findings };
}
