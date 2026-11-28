/**
 * Platform health, in the areas a seller would recognise. Each backend
 * function (Lambda) belongs to one area by its name; an area's requests and
 * errors are the sums of its functions' CloudWatch metrics. Emails also count
 * SES sends and bounces; listing writing also reports Bedrock token use.
 *
 * Read only: CloudWatch GetMetricData and Lambda ListFunctions.
 */

import { CloudWatchClient, GetMetricDataCommand, type MetricDataQuery } from '@aws-sdk/client-cloudwatch';
import { LambdaClient, ListFunctionsCommand } from '@aws-sdk/client-lambda';

export type AreaId =
  | 'accounts'
  | 'products'
  | 'listings'
  | 'imports'
  | 'images'
  | 'exports'
  | 'payments'
  | 'emails'
  | 'chat'
  | 'staff';

export interface AreaDef {
  id: AreaId;
  label: string;
  covers: string;
  /** Function name prefixes (before the "-<env>" suffix). Most specific wins. */
  prefixes: string[];
  /** Plain-language guidance shown on an alert for this area. */
  whatToDo: string;
}

export const AREAS: AreaDef[] = [
  {
    id: 'accounts',
    label: 'Sign-in and accounts',
    covers: 'sign-up, sign-in codes, team invites',
    prefixes: ['merch-os-auth-'],
    whatToDo:
      'Sellers may not be able to sign up or sign in. Try signing in to the seller site yourself. If it fails, tell the team straight away.',
  },
  {
    id: 'products',
    label: 'Products',
    covers: 'adding, editing, product list, stock',
    prefixes: ['merch-os-product-', 'merch-os-inventory-'],
    whatToDo: 'Sellers may see errors adding or editing products. Ask an affected seller to try again; tell the team if it continues.',
  },
  {
    id: 'listings',
    label: 'Listing writing',
    covers: '"Write my listing", rewrites',
    prefixes: ['merch-os-pi-', 'merch-os-product-synthesizeproduct', 'merch-os-product-regenerateattribute'],
    whatToDo:
      'Sellers see "try again" on some listings. The backup writing model takes over automatically; tell the team if it lasts more than an hour.',
  },
  {
    id: 'imports',
    label: 'Supplier imports',
    covers: 'CSV, Excel, PDF and link imports',
    prefixes: ['merch-os-si-'],
    whatToDo: 'Some supplier files may not have been imported. Check Customers for the seller and ask them to upload the file again if it failed.',
  },
  {
    id: 'images',
    label: 'Images',
    covers: 'photo uploads and processing',
    prefixes: ['merch-os-img-'],
    whatToDo: 'Some product photos may not have been processed. Sellers can upload them again; tell the team if it continues.',
  },
  {
    id: 'exports',
    label: 'Exports',
    covers: 'Takealot, Shopify and WooCommerce files',
    prefixes: ['merch-os-export-'],
    whatToDo: 'Sellers may not be able to download export files. Ask them to try again; tell the team if it continues.',
  },
  {
    id: 'payments',
    label: 'Payments',
    covers: 'PayFast checkout, payment notifications, invoices',
    prefixes: ['merch-os-billing-'],
    whatToDo:
      'A payment may not have been applied. Open Billing and look for "Payment problem". Tell the team before the seller is affected.',
  },
  {
    id: 'emails',
    label: 'Emails',
    covers: 'welcome, tips, sign-in codes, review and referral emails',
    prefixes: ['merch-os-engagement-', 'merch-os-auth-custommessage'],
    whatToDo: 'Some emails may not have been sent. Sign-in codes matter most: if sellers say codes are not arriving, tell the team straight away.',
  },
  {
    id: 'chat',
    label: 'Live chat',
    covers: 'website chat and the Support inbox',
    prefixes: ['merch-os-support-chat-'],
    whatToDo: 'Visitors may not be able to start a chat. Check the Support inbox still loads; sellers can email info@merchos.co.za meanwhile.',
  },
  {
    id: 'staff',
    label: 'Staff dashboard',
    covers: 'Customers, Billing, Audit log, Health, Alerts',
    prefixes: ['merch-os-admin-'],
    whatToDo: 'Pages in this dashboard may show errors. Sellers are not affected.',
  },
];

const AREA_BY_ID = new Map(AREAS.map((a) => [a.id, a]));
export const areaDef = (id: AreaId): AreaDef => AREA_BY_ID.get(id)!;

/** The area a function belongs to (longest matching prefix), or null. */
export function areaOf(functionName: string, env: string): AreaId | null {
  const suffix = `-${env}`;
  if (!functionName.endsWith(suffix)) return null;
  let best: { id: AreaId; len: number } | null = null;
  for (const a of AREAS) {
    for (const p of a.prefixes) {
      if (functionName.startsWith(p) && (!best || p.length > best.len)) best = { id: a.id, len: p.length };
    }
  }
  return best?.id ?? null;
}

// ─── AWS clients ────────────────────────────────────────────────────────────

let cw: CloudWatchClient | undefined;
let lambda: LambdaClient | undefined;
/** @internal tests only */
export function _setClients(c: { cw?: CloudWatchClient; lambda?: LambdaClient }): void {
  cw = c.cw;
  lambda = c.lambda;
}
const cloudwatch = () => (cw ??= new CloudWatchClient({}));
const lambdas = () => (lambda ??= new LambdaClient({}));

/** This environment's functions, grouped by area. */
export async function functionsByArea(env: string): Promise<Map<AreaId, string[]>> {
  const out = new Map<AreaId, string[]>();
  let marker: string | undefined;
  for (let page = 0; page < 20; page++) {
    const res = await lambdas().send(new ListFunctionsCommand({ MaxItems: 50, ...(marker ? { Marker: marker } : {}) }));
    for (const f of res.Functions ?? []) {
      const area = f.FunctionName ? areaOf(f.FunctionName, env) : null;
      if (area) out.set(area, [...(out.get(area) ?? []), f.FunctionName!]);
    }
    marker = res.NextMarker;
    if (!marker) break;
  }
  return out;
}

export interface Bucketed {
  /** Bucket start times (ISO), oldest first. */
  times: string[];
  values: number[];
}

/** GetMetricData for many queries at once (500 per call), sums per query id. */
async function getMetrics(
  queries: MetricDataQuery[],
  start: Date,
  end: Date,
): Promise<Map<string, Bucketed>> {
  const out = new Map<string, Bucketed>();
  for (let i = 0; i < queries.length; i += 500) {
    let token: string | undefined;
    for (let page = 0; page < 20; page++) {
      const res = await cloudwatch().send(
        new GetMetricDataCommand({
          MetricDataQueries: queries.slice(i, i + 500),
          StartTime: start,
          EndTime: end,
          ScanBy: 'TimestampAscending',
          ...(token ? { NextToken: token } : {}),
        }),
      );
      for (const r of res.MetricDataResults ?? []) {
        const prev = out.get(r.Id!) ?? { times: [], values: [] };
        prev.times.push(...(r.Timestamps ?? []).map((t) => t.toISOString()));
        prev.values.push(...(r.Values ?? []));
        out.set(r.Id!, prev);
      }
      token = res.NextToken;
      if (!token) break;
    }
  }
  return out;
}

const lambdaMetric = (id: string, fn: string, metric: 'Errors' | 'Invocations', period: number): MetricDataQuery => ({
  Id: id,
  MetricStat: {
    Metric: { Namespace: 'AWS/Lambda', MetricName: metric, Dimensions: [{ Name: 'FunctionName', Value: fn }] },
    Period: period,
    Stat: 'Sum',
  },
  ReturnData: true,
});

const sum = (b: Bucketed | undefined) => (b?.values ?? []).reduce((s, v) => s + v, 0);

/** Adds bucket series together by timestamp. */
export function addSeries(series: Array<Bucketed | undefined>): Map<string, number> {
  const out = new Map<string, number>();
  for (const s of series) {
    s?.times.forEach((t, i) => out.set(t, (out.get(t) ?? 0) + (s.values[i] ?? 0)));
  }
  return out;
}

// ─── Status ─────────────────────────────────────────────────────────────────

export type AreaStatus = 'working' | 'some_errors' | 'down' | 'not_live' | 'no_activity';

/**
 * Down: more than half of requests failed with at least 10 errors.
 * Some errors: any error. Payments without any traffic before checkout opens: not live.
 */
export function statusOf(requests: number, errors: number, opts: { notLive?: boolean } = {}): AreaStatus {
  if (opts.notLive && requests === 0) return 'not_live';
  if (errors >= 10 && requests > 0 && errors / requests > 0.5) return 'down';
  if (errors > 0) return 'some_errors';
  return requests === 0 ? 'no_activity' : 'working';
}

export type HealthRange = '24h' | '7d';
export const RANGE: Record<HealthRange, { seconds: number; bucket: number }> = {
  '24h': { seconds: 24 * 3600, bucket: 3600 },
  '7d': { seconds: 7 * 86400, bucket: 6 * 3600 },
};

export interface AreaHealth {
  id: AreaId;
  label: string;
  covers: string;
  status: AreaStatus;
  requests: number;
  errors: number;
  /** Emails only: messages sent and bounced. */
  sent?: number;
  bounced?: number;
  functions: number;
}

export interface HealthReport {
  range: HealthRange;
  checkedAt: string;
  areas: AreaHealth[];
  /** Errors across all areas per bucket (for the chart). */
  errorSeries: Array<{ at: string; errors: number }>;
  writing: { requests: number; inputTokens: number; outputTokens: number; approxCostCents: number };
}

/** Bedrock list prices per million tokens (USD) for the models we use; rand at a fixed planning rate. */
const MODEL_PRICE_USD_PER_M: Array<{ match: RegExp; input: number; output: number }> = [
  { match: /claude-haiku-4-5/, input: 1, output: 5 },
  { match: /claude-sonnet/, input: 3, output: 15 },
  { match: /nova-pro/, input: 0.8, output: 3.2 },
  { match: /nova-lite/, input: 0.06, output: 0.24 },
];
export const ZAR_PER_USD = 18;

export function writingCostCents(byModel: Array<{ model: string; input: number; output: number }>): number {
  let usd = 0;
  for (const m of byModel) {
    const price = MODEL_PRICE_USD_PER_M.find((p) => p.match.test(m.model)) ?? { input: 3, output: 15 };
    usd += (m.input / 1e6) * price.input + (m.output / 1e6) * price.output;
  }
  return Math.round(usd * ZAR_PER_USD * 100);
}

export async function getHealth(
  env: string,
  range: HealthRange,
  opts: { paymentsLive: boolean; now?: Date } = { paymentsLive: false },
): Promise<HealthReport> {
  const now = opts.now ?? new Date();
  const { seconds, bucket } = RANGE[range];
  const end = new Date(Math.ceil(now.getTime() / (bucket * 1000)) * bucket * 1000);
  const start = new Date(end.getTime() - seconds * 1000);
  const fns = await functionsByArea(env);

  const queries: MetricDataQuery[] = [];
  const ids = new Map<AreaId, { errors: string[]; invocations: string[] }>();
  let n = 0;
  for (const [area, names] of fns) {
    const entry = { errors: [] as string[], invocations: [] as string[] };
    for (const fn of names) {
      const e = `e${n}`;
      const i = `i${n}`;
      n++;
      queries.push(lambdaMetric(e, fn, 'Errors', bucket), lambdaMetric(i, fn, 'Invocations', bucket));
      entry.errors.push(e);
      entry.invocations.push(i);
    }
    ids.set(area, entry);
  }
  // Emails (account level). Bedrock token use is a separate search query below.
  queries.push(
    { Id: 'sesSend', MetricStat: { Metric: { Namespace: 'AWS/SES', MetricName: 'Send' }, Period: bucket, Stat: 'Sum' } },
    { Id: 'sesBounce', MetricStat: { Metric: { Namespace: 'AWS/SES', MetricName: 'Bounce' }, Period: bucket, Stat: 'Sum' } },
  );

  const [data, bedrock] = await Promise.all([getMetrics(queries, start, end), getBedrock(start, end, seconds)]);

  const areas: AreaHealth[] = AREAS.map((a) => {
    const entry = ids.get(a.id);
    const requests = (entry?.invocations ?? []).reduce((s, id) => s + sum(data.get(id)), 0);
    const errors = (entry?.errors ?? []).reduce((s, id) => s + sum(data.get(id)), 0);
    const base: AreaHealth = {
      id: a.id,
      label: a.label,
      covers: a.covers,
      status: statusOf(requests, errors, { notLive: a.id === 'payments' && !opts.paymentsLive }),
      requests,
      errors,
      functions: entry?.errors.length ?? 0,
    };
    if (a.id !== 'emails') return base;
    const sent = sum(data.get('sesSend'));
    const bounced = sum(data.get('sesBounce'));
    return { ...base, sent, bounced, status: statusOf(requests + sent, errors + bounced) };
  });

  const series = addSeries([...ids.values()].flatMap((e) => e.errors.map((id) => data.get(id))));
  const errorSeries: HealthReport['errorSeries'] = [];
  for (let t = start.getTime(); t < end.getTime(); t += bucket * 1000) {
    const at = new Date(t).toISOString();
    errorSeries.push({ at, errors: series.get(at) ?? 0 });
  }

  return {
    range,
    checkedAt: now.toISOString(),
    areas,
    errorSeries,
    writing: {
      requests: bedrock.requests,
      inputTokens: bedrock.byModel.reduce((s, m) => s + m.input, 0),
      outputTokens: bedrock.byModel.reduce((s, m) => s + m.output, 0),
      approxCostCents: writingCostCents(bedrock.byModel),
    },
  };
}

/** Bedrock token use per model over the whole range. */
async function getBedrock(start: Date, end: Date, seconds: number) {
  const res = await cloudwatch().send(
    new GetMetricDataCommand({
      StartTime: start,
      EndTime: end,
      MetricDataQueries: [
        { Id: 'in', Expression: `SEARCH('{AWS/Bedrock,ModelId} MetricName="InputTokenCount"', 'Sum', ${seconds})` },
        { Id: 'out', Expression: `SEARCH('{AWS/Bedrock,ModelId} MetricName="OutputTokenCount"', 'Sum', ${seconds})` },
        { Id: 'req', Expression: `SEARCH('{AWS/Bedrock,ModelId} MetricName="Invocations"', 'Sum', ${seconds})` },
      ],
    }),
  );
  const byModel = new Map<string, { model: string; input: number; output: number }>();
  let requests = 0;
  for (const r of res.MetricDataResults ?? []) {
    // Labels look like "<modelId> InputTokenCount" or just the model id.
    const model = (r.Label ?? '').split(' ')[0] ?? '';
    const total = (r.Values ?? []).reduce((s, v) => s + v, 0);
    const kind = r.Id?.startsWith('in') ? 'input' : r.Id?.startsWith('out') ? 'output' : 'req';
    if (kind === 'req') {
      requests += total;
      continue;
    }
    const m = byModel.get(model) ?? { model, input: 0, output: 0 };
    m[kind] += total;
    byModel.set(model, m);
  }
  return { requests, byModel: [...byModel.values()] };
}

// ─── Quick check (every 15 minutes) ─────────────────────────────────────────

export interface AreaCheck {
  id: AreaId;
  errors: number;
  requests: number;
}

/**
 * Cheap check: errors first (one metric per function); requests only for areas
 * that had errors, to work out the failure rate.
 */
export async function quickCheck(env: string, minutes: number, now: Date = new Date()): Promise<AreaCheck[]> {
  const period = minutes * 60;
  const end = new Date(Math.floor(now.getTime() / 60000) * 60000);
  const start = new Date(end.getTime() - period * 1000);
  const fns = await functionsByArea(env);
  const index: Array<{ area: AreaId; fn: string }> = [];
  for (const [area, names] of fns) for (const fn of names) index.push({ area, fn });

  const errors = await getMetrics(
    index.map((x, i) => lambdaMetric(`e${i}`, x.fn, 'Errors', period)),
    start,
    end,
  );
  const errorsBy = new Map<AreaId, number>();
  index.forEach((x, i) => errorsBy.set(x.area, (errorsBy.get(x.area) ?? 0) + sum(errors.get(`e${i}`))));

  const failing = index.map((x, i) => ({ ...x, i })).filter((x) => (errorsBy.get(x.area) ?? 0) > 0);
  const invocations = failing.length
    ? await getMetrics(failing.map((x) => lambdaMetric(`i${x.i}`, x.fn, 'Invocations', period)), start, end)
    : new Map<string, Bucketed>();
  const requestsBy = new Map<AreaId, number>();
  for (const x of failing) requestsBy.set(x.area, (requestsBy.get(x.area) ?? 0) + sum(invocations.get(`i${x.i}`)));

  return AREAS.map((a) => ({ id: a.id, errors: errorsBy.get(a.id) ?? 0, requests: requestsBy.get(a.id) ?? 0 }));
}

/** An area needs an alert: at least 3 errors and 5% of requests failing (or 20+ errors). */
export function needsAlert(c: AreaCheck): boolean {
  if (c.errors >= 20) return true;
  return c.errors >= 3 && c.requests > 0 && c.errors / c.requests >= 0.05;
}
