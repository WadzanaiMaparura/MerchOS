/**
 * Listing quality test bench.
 *
 *   npm run bench                         every case in bench/cases (all folders)
 *   npm run bench -- --only mug-350,kettle-17   just these cases
 *   npm run bench -- --judge              add the model accuracy cross-check (one extra call per product)
 *   npm run bench -- --label "new bullet prompt"   name the run (shown on the scorecard)
 *   npm run bench:report                  re-render the latest run with your review.csv
 *   npm run bench:report -- 20261201-0930 re-render a given run
 *
 * Run from services/product-intelligence. Uses AWS (Bedrock, and the dev
 * prompt table for the live prompts): profile merchos-admin, eu-west-1, unless
 * AWS_PROFILE / AWS_REGION / PRODUCT_INTELLIGENCE_TABLE say otherwise.
 *
 * A case is a JSON file (one case, or a list) like bench/cases/examples/*.json.
 * Put real products in bench/cases/private/ (not committed). Each run is saved
 * in bench/runs/<date-time>/ (not committed): scorecard.html, review.csv, run.json.
 */

import { existsSync, mkdirSync, readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import type { BenchCase, CheckFinding, Review } from './types';

const BENCH = resolve(__dirname);
const RUNS = join(BENCH, 'runs');
/** Products written at the same time (each is five model calls). */
const PARALLEL = 2;

// Settings must be in place before the model config is first loaded.
process.env['AWS_REGION'] ??= 'eu-west-1';
if (!process.env['AWS_ACCESS_KEY_ID']) process.env['AWS_PROFILE'] ??= 'merchos-admin';
process.env['PRODUCT_INTELLIGENCE_TABLE'] ??= 'product-intelligence-dev';
process.env['BEDROCK_FALLBACK_MODEL_ID'] ??= 'eu.amazon.nova-pro-v1:0';

function arg(name: string): string | undefined {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 ? process.argv[i + 1] : undefined;
}
const flag = (name: string) => process.argv.includes(`--${name}`);

/** Every case file under a folder (one case or a list per file). */
export function loadCases(dir: string): Array<{ c: BenchCase; file: string }> {
  const out: Array<{ c: BenchCase; file: string }> = [];
  const walk = (d: string) => {
    for (const name of readdirSync(d)) {
      const p = join(d, name);
      if (statSync(p).isDirectory()) walk(p);
      else if (name.endsWith('.json')) {
        const parsed = JSON.parse(readFileSync(p, 'utf8')) as BenchCase | BenchCase[];
        for (const c of Array.isArray(parsed) ? parsed : [parsed]) {
          if (!c.id || !c.label || !c.source) throw new Error(`${p}: every case needs id, label and source`);
          out.push({ c, file: p });
        }
      }
    }
  };
  walk(dir);
  const ids = out.map((x) => x.c.id);
  const dup = ids.find((id, i) => ids.indexOf(id) !== i);
  if (dup) throw new Error(`Case id "${dup}" is used twice`);
  return out;
}

const stamp = (d: Date) => d.toISOString().slice(0, 16).replace(/[-:]/g, '').replace('T', '-');

async function mapLimit<T, R>(items: T[], limit: number, fn: (t: T, i: number) => Promise<R>): Promise<R[]> {
  const out: R[] = new Array(items.length);
  let next = 0;
  await Promise.all(
    Array.from({ length: Math.min(limit, items.length) }, async () => {
      while (next < items.length) {
        const i = next++;
        out[i] = await fn(items[i]!, i);
      }
    }),
  );
  return out;
}

function previousRun(before: string): string | undefined {
  if (!existsSync(RUNS)) return undefined;
  return readdirSync(RUNS)
    .filter((d) => d < before && existsSync(join(RUNS, d, 'run.json')))
    .sort()
    .at(-1);
}

async function bench(): Promise<void> {
  const { loadSource } = await import('./source');
  const { runPipeline } = await import('./pipeline');
  const { scoreCase } = await import('./checks');
  const { judge } = await import('./judge');
  const { renderScorecard, reviewTemplate } = await import('./scorecard');

  const all = loadCases(resolve(arg('cases') ?? join(BENCH, 'cases')));
  const only = arg('only')?.split(',').map((s) => s.trim());
  const chosen = only ? all.filter((x) => only.includes(x.c.id)) : all;
  if (!chosen.length) throw new Error('No cases to run');
  const useJudge = flag('judge');
  const startedAt = new Date();
  const runId = stamp(startedAt);
  console.log(`Running ${chosen.length} product${chosen.length === 1 ? '' : 's'}${useJudge ? ' with the cross-check' : ''}...`);

  const results = await mapLimit(chosen, PARALLEL, async ({ c, file }, i) => {
    const { productData, sourceText } = loadSource(c, file);
    const output = await runPipeline(c.id, productData, c.marketplace ?? 'takealot');
    let extra: CheckFinding[] = [];
    if (useJudge && output.title) {
      extra = await judge(sourceText, output).catch((e: Error) => [
        { area: 'accuracy' as const, level: 'warn' as const, message: `Cross-check did not run: ${e.message ?? e}` },
      ]);
    }
    const score = scoreCase(c, output, sourceText, extra);
    console.log(`  ${i + 1}/${chosen.length} ${c.id}: ${score.score}${output.errors.length ? ` (${output.errors.length} step(s) failed)` : ''}`);
    return { c, output, score };
  });

  const run = {
    runId,
    startedAt: startedAt.toISOString(),
    ...(arg('label') ? { label: arg('label')! } : {}),
    judge: useJudge,
    cases: results.map((r) => r.c),
    outputs: results.map((r) => r.output),
    scores: results.map((r) => r.score),
  };
  const dir = join(RUNS, runId);
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, 'run.json'), JSON.stringify(run, null, 2));
  writeFileSync(join(dir, 'review.csv'), reviewTemplate(run));
  const prevId = previousRun(runId);
  const prev = prevId ? JSON.parse(readFileSync(join(RUNS, prevId, 'run.json'), 'utf8')) : undefined;
  writeFileSync(join(dir, 'scorecard.html'), renderScorecard(run, [], prev));
  const overall = Math.round(run.scores.reduce((s, x) => s + x.score, 0) / run.scores.length);
  console.log(`\nOverall ${overall}/100. Scorecard: ${join(dir, 'scorecard.html')}\nReview sheet: ${join(dir, 'review.csv')}`);
}

async function report(): Promise<void> {
  const { renderScorecard, parseReviews, reviewTemplate } = await import('./scorecard');
  const id = process.argv.find((a) => /^\d{8}-\d{4}$/.test(a)) ?? (existsSync(RUNS) ? readdirSync(RUNS).sort().at(-1) : undefined);
  if (!id || !existsSync(join(RUNS, id, 'run.json'))) throw new Error('No run found');
  const dir = join(RUNS, id);
  const run = JSON.parse(readFileSync(join(dir, 'run.json'), 'utf8'));
  const reviews: Review[] = existsSync(join(dir, 'review.csv')) ? parseReviews(readFileSync(join(dir, 'review.csv'), 'utf8')) : [];
  const prevId = previousRun(id);
  const prev = prevId ? JSON.parse(readFileSync(join(RUNS, prevId, 'run.json'), 'utf8')) : undefined;
  writeFileSync(join(dir, 'scorecard.html'), renderScorecard(run, reviews, prev));
  writeFileSync(join(dir, 'review.csv'), reviewTemplate(run, reviews));
  console.log(`${reviews.length} review(s) added. Scorecard: ${join(dir, 'scorecard.html')}`);
}

(process.argv.includes('report') ? report() : bench()).catch((e: Error) => {
  console.error(e.message ?? e);
  process.exit(1);
});
