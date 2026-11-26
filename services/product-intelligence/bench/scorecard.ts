/**
 * The scorecard: one HTML page per run (open it in a browser), plus
 * review.csv for your verdicts (good / fix / bad and a note per product).
 * Re-rendering a run reads review.csv back in, so your verdicts appear on the
 * scorecard and count towards the totals. Each run is compared with the run
 * before it: overall, per area, and per product.
 */

import type { Area, BenchCase, BenchOutput, CaseScore, Review } from './types';
import { WEIGHTS } from './checks';

export const AREAS: Area[] = ['accuracy', 'completeness', 'rules', 'category', 'language'];
export const AREA_LABEL: Record<Area, string> = {
  accuracy: 'Accuracy',
  completeness: 'Completeness',
  rules: 'Marketplace rules',
  category: 'Category',
  language: 'Language',
};

export interface RunRecord {
  runId: string;
  startedAt: string;
  label?: string;
  judge: boolean;
  cases: BenchCase[];
  outputs: BenchOutput[];
  scores: CaseScore[];
}

export interface Summary {
  overall: number;
  byArea: Record<Area, number | null>;
  /** Share of products with no failure at all, 0-100. */
  cleanPct: number;
  topProblems: Array<{ message: string; count: number }>;
  reviews: { good: number; fix: number; bad: number; pending: number };
}

const avg = (xs: number[]) => (xs.length ? Math.round(xs.reduce((s, x) => s + x, 0) / xs.length) : 0);

/** "Required attribute missing: Capacity" and "...: Material" count as one problem. */
const problemKey = (m: string) => m.replace(/"[^"]*"/g, '"…"').replace(/:\s.*$/, '').replace(/\d+/g, 'N');

export function summarise(run: RunRecord, reviews: Review[] = []): Summary {
  const byArea = Object.fromEntries(
    AREAS.map((a) => {
      const xs = run.scores.map((s) => s.byArea[a]).filter((x): x is number => x !== null);
      return [a, xs.length ? avg(xs) : null];
    }),
  ) as Record<Area, number | null>;
  const counts = new Map<string, number>();
  for (const s of run.scores) {
    for (const k of new Set(s.findings.filter((f) => f.level === 'fail').map((f) => problemKey(f.message)))) {
      counts.set(k, (counts.get(k) ?? 0) + 1);
    }
  }
  const verdict = new Map(reviews.map((r) => [r.caseId, r.verdict]));
  return {
    overall: avg(run.scores.map((s) => s.score)),
    byArea,
    cleanPct: run.scores.length ? Math.round((100 * run.scores.filter((s) => !s.findings.some((f) => f.level === 'fail')).length) / run.scores.length) : 0,
    topProblems: [...counts].map(([message, count]) => ({ message, count })).sort((a, b) => b.count - a.count).slice(0, 8),
    reviews: {
      good: run.cases.filter((c) => verdict.get(c.id) === 'good').length,
      fix: run.cases.filter((c) => verdict.get(c.id) === 'fix').length,
      bad: run.cases.filter((c) => verdict.get(c.id) === 'bad').length,
      pending: run.cases.filter((c) => !verdict.has(c.id)).length,
    },
  };
}

// ─── review.csv ──────────────────────────────────────────────────────────────

const csvCell = (s: string) => (/[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s);

export function reviewTemplate(run: RunRecord, existing: Review[] = []): string {
  const by = new Map(existing.map((r) => [r.caseId, r]));
  const rows = run.cases.map((c) => {
    const s = run.scores.find((x) => x.caseId === c.id);
    const r = by.get(c.id);
    return [c.id, c.label, String(s?.score ?? ''), r?.verdict ?? '', r?.note ?? ''].map(csvCell).join(',');
  });
  return ['id,product,score,verdict (good / fix / bad),note', ...rows].join('\n') + '\n';
}

/** Reads review.csv (tolerates spreadsheets re-saving it: quotes, extra columns, blank rows). */
export function parseReviews(csv: string): Review[] {
  const rows: string[][] = [];
  let row: string[] = [];
  let cell = '';
  let quoted = false;
  const text = csv.replace(/^\uFEFF/, '');
  for (let i = 0; i < text.length; i++) {
    const ch = text[i]!;
    if (quoted) {
      if (ch === '"' && text[i + 1] === '"') {
        cell += '"';
        i++;
      } else if (ch === '"') quoted = false;
      else cell += ch;
    } else if (ch === '"') quoted = true;
    else if (ch === ',' || ch === ';') {
      row.push(cell);
      cell = '';
    } else if (ch === '\n' || ch === '\r') {
      if (ch === '\r' && text[i + 1] === '\n') i++;
      row.push(cell);
      rows.push(row);
      row = [];
      cell = '';
    } else cell += ch;
  }
  if (cell || row.length) rows.push([...row, cell]);
  return rows
    .slice(1)
    .map((r) => ({ caseId: (r[0] ?? '').trim(), verdict: (r[3] ?? '').trim().toLowerCase(), note: (r[4] ?? '').trim() }))
    .filter((r): r is { caseId: string; verdict: Review['verdict']; note: string } => !!r.caseId && ['good', 'fix', 'bad'].includes(r.verdict))
    .map((r) => ({ caseId: r.caseId, verdict: r.verdict, ...(r.note ? { note: r.note } : {}) }));
}

// ─── HTML ────────────────────────────────────────────────────────────────────

const esc = (s: unknown) =>
  String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!);

const tone = (n: number | null) => (n === null ? 'na' : n >= 85 ? 'good' : n >= 65 ? 'ok' : 'bad');
const delta = (now: number | null, before: number | null | undefined) => {
  if (now === null || before === null || before === undefined) return '';
  const d = now - before;
  return d === 0 ? '<span class="d">±0</span>' : `<span class="d ${d > 0 ? 'up' : 'down'}">${d > 0 ? '+' : ''}${d}</span>`;
};

const when = (iso: string) =>
  new Date(iso).toLocaleString('en-ZA', { timeZone: 'Africa/Johannesburg', day: 'numeric', month: 'long', year: 'numeric', hour: '2-digit', minute: '2-digit' });

function productBlock(c: BenchCase, o: BenchOutput | undefined, s: CaseScore | undefined, r: Review | undefined, before: CaseScore | undefined): string {
  const fails = s?.findings.filter((f) => f.level === 'fail') ?? [];
  const warns = s?.findings.filter((f) => f.level === 'warn') ?? [];
  const src = o?.productData;
  const list = (xs: string[] | undefined) => (xs?.length ? `<ul>${xs.map((x) => `<li>${esc(x)}</li>`).join('')}</ul>` : '<p class="muted">None</p>');
  return `
  <details id="${esc(c.id)}" ${fails.length ? 'open' : ''}>
    <summary>
      <span class="score ${tone(s?.score ?? null)}">${s?.score ?? '–'}</span>${delta(s?.score ?? null, before?.score)}
      <b>${esc(c.label)}</b> <span class="muted">${esc(c.group ?? '')} · ${esc(c.marketplace ?? 'takealot')}${c.example ? ' · example' : ''}</span>
      ${fails.length ? `<span class="pill bad">${fails.length} problem${fails.length === 1 ? '' : 's'}</span>` : ''}
      ${warns.length ? `<span class="pill ok">${warns.length} to improve</span>` : ''}
      ${r ? `<span class="pill ${r.verdict === 'good' ? 'good' : r.verdict === 'fix' ? 'ok' : 'bad'}">You: ${esc(r.verdict)}</span>` : ''}
    </summary>
    ${r?.note ? `<p class="note">Your note: ${esc(r.note)}</p>` : ''}
    ${s?.findings.length ? `<ul class="findings">${s.findings.map((f) => `<li class="${f.level}"><b>${f.level === 'fail' ? 'Problem' : 'Improve'}</b> · ${esc(AREA_LABEL[f.area])}: ${esc(f.message)}</li>`).join('')}</ul>` : '<p class="good-text">No problems found.</p>'}
    <div class="cols">
      <section><h4>What the seller gave us</h4>
        <p><b>${esc(src?.name ?? '')}</b></p>
        ${src?.brand ? `<p>Brand: ${esc(src.brand)}</p>` : ''}${src?.category ? `<p>Category: ${esc(src.category)}</p>` : ''}
        <p class="pre">${esc(src?.description ?? '')}</p>
        ${src?.attributes ? list(Object.entries(src.attributes).map(([k, v]) => `${k}: ${v}`)) : ''}
      </section>
      <section><h4>What MerchOS wrote</h4>
        <p><b>${esc(o?.title ?? '(no title)')}</b> <span class="muted">${o?.title?.length ?? 0} characters</span></p>
        ${list(o?.bullets)}
        <p class="pre">${esc(o?.description ?? '')}</p>
        <h5>Attributes</h5>${list(o?.attributes?.map((a) => `${a.key}: ${a.value}`))}
        <h5>Category</h5>${list(o?.categories?.slice(0, 3).map((p) => `${p.path.join(' > ')} (${Math.round(p.confidence * 100)}%)`))}
      </section>
      ${c.gold ? `<section><h4>Gold listing</h4><p><b>${esc(c.gold.title ?? '')}</b></p>${list(c.gold.bullets)}<p class="pre">${esc(c.gold.description ?? '')}</p></section>` : ''}
    </div>
  </details>`;
}

export function renderScorecard(run: RunRecord, reviews: Review[] = [], previous?: RunRecord): string {
  const sum = summarise(run, reviews);
  const prev = previous ? summarise(previous) : undefined;
  const prevScore = new Map(previous?.scores.map((s) => [s.caseId, s]) ?? []);
  const rev = new Map(reviews.map((r) => [r.caseId, r]));
  const order = [...run.cases].sort((a, b) => (run.scores.find((s) => s.caseId === a.id)?.score ?? 0) - (run.scores.find((s) => s.caseId === b.id)?.score ?? 0));
  const models = [...new Set(run.outputs.flatMap((o) => o.modelIds))].join(', ') || 'unknown';
  return `<!doctype html>
<html lang="en-ZA"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<title>MerchOS listing quality: ${esc(run.label ?? run.runId)}</title>
<style>
  body{font-family:Inter,Arial,sans-serif;color:#111827;margin:0;background:#f9fafb}
  main{max-width:1200px;margin:0 auto;padding:24px}
  h1{font-size:22px;margin:0 0 4px} h2{font-size:16px;margin:28px 0 10px} h4{margin:0 0 8px;font-size:14px} h5{margin:12px 0 4px;font-size:13px}
  .muted{color:#4b5563;font-size:13px} .pre{white-space:pre-wrap} .note{background:#fffbeb;padding:8px;border-radius:6px}
  .cards{display:flex;flex-wrap:wrap;gap:12px} .card{background:#fff;border:1px solid #e5e7eb;border-radius:10px;padding:12px 16px;min-width:140px}
  .card .n{font-size:28px;font-weight:700} .card .l{font-size:13px;color:#4b5563}
  .good{color:#166534} .ok{color:#92400e} .bad{color:#991b1b} .na{color:#6b7280}
  .d{font-size:12px;margin-left:6px;color:#4b5563} .d.up{color:#166534} .d.down{color:#991b1b}
  details{background:#fff;border:1px solid #e5e7eb;border-radius:10px;margin:10px 0;padding:10px 14px}
  summary{cursor:pointer;display:flex;align-items:center;gap:8px;flex-wrap:wrap}
  summary:focus-visible{outline:2px solid #2563eb;outline-offset:2px}
  .score{font-weight:700;font-size:18px;min-width:34px}
  .pill{font-size:12px;border-radius:999px;padding:2px 8px;background:#f3f4f6}
  .pill.bad{background:#fee2e2} .pill.ok{background:#fef3c7} .pill.good{background:#dcfce7}
  .findings{margin:10px 0;padding-left:18px;font-size:14px} .findings .fail{color:#991b1b} .findings .warn{color:#92400e}
  .good-text{color:#166534;font-size:14px}
  .cols{display:grid;grid-template-columns:repeat(auto-fit,minmax(300px,1fr));gap:16px;margin-top:10px;font-size:14px}
  .cols section{background:#f9fafb;border-radius:8px;padding:10px}
  table{border-collapse:collapse;background:#fff;font-size:14px} th,td{border:1px solid #e5e7eb;padding:6px 10px;text-align:left}
</style></head>
<body><main>
  <h1>Listing quality${run.label ? `: ${esc(run.label)}` : ''}</h1>
  <p class="muted">${esc(when(run.startedAt))} · ${run.cases.length} products · models: ${esc(models)}${run.judge ? ' · with accuracy cross-check' : ''}${previous ? ` · compared with ${esc(previous.label ?? previous.runId)}` : ''}</p>

  <div class="cards" role="list">
    <div class="card" role="listitem"><div class="n ${tone(sum.overall)}">${sum.overall}${delta(sum.overall, prev?.overall)}</div><div class="l">Overall score (0-100)</div></div>
    <div class="card" role="listitem"><div class="n">${sum.cleanPct}%</div><div class="l">Products with no problems</div></div>
    ${AREAS.map((a) => `<div class="card" role="listitem"><div class="n ${tone(sum.byArea[a])}">${sum.byArea[a] ?? '–'}${delta(sum.byArea[a], prev?.byArea[a])}</div><div class="l">${AREA_LABEL[a]} (counts ${WEIGHTS[a]}%)</div></div>`).join('')}
    <div class="card" role="listitem"><div class="n">${sum.reviews.good}/${sum.reviews.fix}/${sum.reviews.bad}</div><div class="l">Your review: good / fix / bad (${sum.reviews.pending} not reviewed)</div></div>
  </div>

  <h2>Most common problems</h2>
  ${sum.topProblems.length ? `<table><thead><tr><th scope="col">Problem</th><th scope="col">Products</th></tr></thead><tbody>${sum.topProblems.map((p) => `<tr><td>${esc(p.message)}</td><td>${p.count}</td></tr>`).join('')}</tbody></table>` : '<p class="good-text">No problems found in this run.</p>'}

  <h2>Products (weakest first)</h2>
  ${order.map((c) => productBlock(c, run.outputs.find((o) => o.caseId === c.id), run.scores.find((s) => s.caseId === c.id), rev.get(c.id), prevScore.get(c.id))).join('')}

  <p class="muted">Scores: each area starts at 100; a problem costs 50, an improvement 15. A wrong fact caps the product at 50. Fill in review.csv next to this page, then run <code>npm run bench:report</code> to add your verdicts.</p>
</main></body></html>`;
}
