'use client';

/**
 * Seller Dashboard — overview of the create-listings pipeline, credits, and
 * downloadable marketplace CSVs.
 *
 * Designed to sit INSIDE the (dashboard) app shell (sidebar + top bar provide
 * global chrome), so this renders a slim page header + content.
 *
 * Product model (confirmed with product owner):
 *  - A seller uploads mixed media (images + PDF + text + a video URL) for one
 *    or many products, names a BATCH, and selects target marketplace(s).
 *  - MerchOS AI-synthesises a complete marketplace listing per product, the
 *    seller reviews/corrects/approves, then MerchOS generates the full
 *    PRODUCT CSV (content loadsheet) per marketplace for download.
 *  - Pricing / stock / lead time are NOT our concern — the seller sets those
 *    directly on the marketplace after uploading the Product CSV.
 *  - Tokenisation is Kiro-style: a monthly plan includes a bundle of CREDITS;
 *    AI actions consume credits; exceeding the allowance is overage.
 *
 * The full structure renders ahead of the backend, but with no fabricated
 * figures: credit counts are zero and the batch lists are empty until real
 * data is connected. Buttons are wired to placeholder routes, ready to connect
 * to the real workflow later.
 *
 * Palette: MerchOS slate + primary blue. No emoji, no em dashes.
 */

import React, { useMemo, useState, useRef, useEffect, useCallback } from 'react';
import { useRouter } from 'next/navigation';
import { Card, Badge, ProgressBar, DataTable } from '@merch-os/ui';
import type { ColumnDef, BadgeVariant } from '@merch-os/ui';

// ─── Marketplaces (for the Create Listings selector) ───────────────────────────

interface Marketplace {
  id: string;
  name: string;
}

const MARKETPLACES: Marketplace[] = [
  { id: 'takealot', name: 'Takealot' },
  { id: 'amazon', name: 'Amazon' },
  { id: 'shopify', name: 'Shopify' },
  { id: 'makro', name: 'Makro' },
  { id: 'woocommerce', name: 'WooCommerce' },
];

// ─── Pipeline stages ────────────────────────────────────────────────────────────

type Stage = 'DRAFT' | 'GENERATING' | 'NEEDS_REVIEW' | 'CSV_READY' | 'EXPORTED';

const STAGE_LABEL: Record<Stage, string> = {
  DRAFT: 'Draft',
  GENERATING: 'Generating',
  NEEDS_REVIEW: 'Needs review',
  CSV_READY: 'CSV ready',
  EXPORTED: 'Exported',
};

const STAGE_VARIANT: Record<Stage, BadgeVariant> = {
  DRAFT: 'neutral',
  GENERATING: 'info',
  NEEDS_REVIEW: 'info',
  CSV_READY: 'success',
  EXPORTED: 'neutral',
};

// ─── Tokenisation (Kiro-style monthly credits + overage) ───────────────────────

// EMPTY PLACEHOLDERS: the dashboard structure renders before the backend is
// connected, but with no fabricated figures. Counts are zero and the batch
// lists are empty until real data arrives.
const CREDITS = {
  monthlyIncluded: 0,
  used: 0,
  overage: 0,
  overageUnitPriceMinor: 0,
  planName: '—',
  planCurrency: 'ZAR',
  cycleResetsAt: '',
  breakdown: [
    { label: 'MerchOS enrichment', credits: 0 },
    { label: 'Image generation', credits: 0 },
    { label: 'CSV generation', credits: 0 },
  ],
} as const;

const STAGES: { stage: Stage; count: number; note: string }[] = [
  { stage: 'DRAFT', count: 0, note: 'uploaded, not started' },
  { stage: 'GENERATING', count: 0, note: 'AI synthesising' },
  { stage: 'NEEDS_REVIEW', count: 0, note: 'awaiting your approval' },
  { stage: 'CSV_READY', count: 0, note: 'ready to download' },
  { stage: 'EXPORTED', count: 0, note: 'downloaded by you' },
];

// ─── Batches (seller-named files, each may hold many products) ──────────────────

interface ReviewBatch {
  id: string;
  batchName: string;
  productCount: number;
  marketplaces: string[];
}

interface ReadyBatch {
  id: string;
  batchName: string;
  productCount: number;
  marketplaces: string[];
}

interface ActivityBatch {
  id: string;
  batchName: string;
  marketplaces: string[];
  stage: Stage;
  products: number;
  updatedAt: string;
}

// Empty until the backend is connected — the sections render their own
// "nothing yet" empty states rather than fabricated batches.
const REVIEW: ReviewBatch[] = [];

const READY: ReadyBatch[] = [];

const ACTIVITY: ActivityBatch[] = [];

// ─── Helpers ────────────────────────────────────────────────────────────────────

function formatDate(iso: string): string {
  try {
    return new Intl.DateTimeFormat('en-GB', { dateStyle: 'medium' }).format(new Date(iso));
  } catch {
    return iso;
  }
}

function daysUntil(iso: string): number {
  return Math.max(0, Math.ceil((new Date(iso).getTime() - Date.now()) / 86_400_000));
}

// ─── Page ─────────────────────────────────────────────────────────────────────

export default function DashboardPage() {
  const router = useRouter();
  const c = CREDITS;

  const inOverage = c.overage > 0;
  const creditsLeft = Math.max(0, c.monthlyIncluded - c.used);
  const resetDays = daysUntil(c.cycleResetsAt);
  const totalUsed = c.used + c.overage;

  // Create Listings: marketplace multi-select dropdown.
  const [pickerOpen, setPickerOpen] = useState(false);
  const [selected, setSelected] = useState<string[]>([]);
  const pickerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!pickerOpen) return;
    const onDocClick = (e: MouseEvent) => {
      if (pickerRef.current && !pickerRef.current.contains(e.target as Node)) setPickerOpen(false);
    };
    document.addEventListener('mousedown', onDocClick);
    return () => document.removeEventListener('mousedown', onDocClick);
  }, [pickerOpen]);

  const allSelected = selected.length === MARKETPLACES.length;
  const toggleMarketplace = (id: string) =>
    setSelected((prev) => (prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]));
  const toggleAll = () => setSelected(allSelected ? [] : MARKETPLACES.map((m) => m.id));

  const startCreate = useCallback(() => {
    const qs = selected.length ? `?marketplaces=${selected.join(',')}` : '';
    router.push(`/create${qs}`);
  }, [router, selected]);

  const activityColumns: ColumnDef<ActivityBatch>[] = useMemo(
    () => [
      { id: 'batchName', header: 'Batch', cell: (r) => (
        <div>
          <span className="font-medium text-gray-900">{r.batchName}</span>
          <span className="ml-2 text-xs text-gray-400">{r.products} products</span>
        </div>
      ) },
      { id: 'marketplaces', header: 'Marketplaces', cell: (r) => <span className="text-gray-700">{r.marketplaces.join(', ')}</span> },
      { id: 'stage', header: 'Stage', cell: (r) => <Badge variant={STAGE_VARIANT[r.stage]}>{STAGE_LABEL[r.stage]}</Badge> },
      { id: 'updatedAt', header: 'Updated', cell: (r) => <span className="text-gray-500">{formatDate(r.updatedAt)}</span> },
    ],
    []
  );

  return (
    <div className="mx-auto max-w-6xl space-y-6">
      {/* ── Page header + Create Listings ─────────────────────────────────── */}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-xl font-semibold tracking-tight text-gray-900">Overview</h1>
          <p className="text-sm text-gray-500">Marketplace Automation, Engineered for Accuracy &amp; Speed.</p>
        </div>
        <div className="flex items-center gap-2">
          {/* Create Listings: click opens a marketplace multi-select */}
          <div ref={pickerRef} className="relative">
            <button
              type="button"
              onClick={() => setPickerOpen((o) => !o)}
              aria-haspopup="true"
              aria-expanded={pickerOpen}
              className="inline-flex items-center gap-2 rounded-md bg-primary-600 px-4 py-2 text-sm font-semibold text-white shadow-sm transition-colors hover:bg-primary-700 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary-600 focus-visible:ring-offset-2"
            >
              <PlusIcon />
              Create listings
              <ChevronIcon />
            </button>

            {pickerOpen && (
              <div className="absolute right-0 z-50 mt-2 w-64 overflow-hidden rounded-md border border-gray-200 bg-white shadow-lg">
                <div className="border-b border-gray-100 px-3 py-2">
                  <p className="text-xs font-medium uppercase tracking-wide text-gray-400">Select marketplaces</p>
                </div>
                <label className="flex cursor-pointer items-center gap-2 border-b border-gray-100 px-3 py-2 text-sm hover:bg-gray-50">
                  <input type="checkbox" checked={allSelected} onChange={toggleAll} className="h-4 w-4 rounded border-gray-300 text-primary-600 focus-visible:ring-primary-600" />
                  <span className="font-medium text-gray-900">All marketplaces</span>
                </label>
                <ul className="max-h-60 overflow-y-auto py-1">
                  {MARKETPLACES.map((m) => (
                    <li key={m.id}>
                      <label className="flex cursor-pointer items-center gap-2 px-3 py-2 text-sm hover:bg-gray-50">
                        <input
                          type="checkbox"
                          checked={selected.includes(m.id)}
                          onChange={() => toggleMarketplace(m.id)}
                          className="h-4 w-4 rounded border-gray-300 text-primary-600 focus-visible:ring-primary-600"
                        />
                        <span className="text-gray-900">{m.name}</span>
                      </label>
                    </li>
                  ))}
                </ul>
                <div className="border-t border-gray-100 p-2">
                  <button
                    type="button"
                    onClick={startCreate}
                    disabled={selected.length === 0}
                    className="w-full rounded-md bg-primary-600 px-3 py-2 text-sm font-semibold text-white shadow-sm transition-colors hover:bg-primary-700 disabled:cursor-not-allowed disabled:bg-primary-600/40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary-600 focus-visible:ring-offset-2"
                  >
                    {selected.length === 0
                      ? 'Select at least one'
                      : `Continue with ${selected.length} marketplace${selected.length === 1 ? '' : 's'}`}
                  </button>
                </div>
              </div>
            )}
          </div>
        </div>
      </div>

      {/* ── Credits hero (tokenisation) ──────────────────────────────────── */}
      <Card padding="lg" className="border-gray-200">
        <div className="flex flex-col gap-5 lg:flex-row lg:items-center lg:justify-between">
          <div className="min-w-0 flex-1">
            <div className="flex items-center gap-2">
              <h2 className="text-sm font-semibold text-gray-900">Monthly credits</h2>
              <Badge variant="neutral">{c.planName} plan</Badge>
              {inOverage && <Badge variant="warning">In overage</Badge>}
            </div>

            <div className="mt-2 flex items-baseline gap-2">
              <span className="text-3xl font-bold tracking-tight text-gray-900">{c.used.toLocaleString()}</span>
              <span className="text-sm text-gray-500">of {c.monthlyIncluded.toLocaleString()} credits used</span>
            </div>

            <div className="mt-3">
              {/* Always MerchOS blue (variant 'default'); numeric left + overage badge convey limit state. */}
              <ProgressBar
                label="Credits this cycle"
                value={Math.min(c.used, c.monthlyIncluded)}
                max={c.monthlyIncluded}
                size="lg"
                showValue={false}
                variant="default"
              />
            </div>

            <div className="mt-2 flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-gray-500">
              <span>
                {inOverage ? (
                  <span className="font-medium text-amber-700">{c.overage.toLocaleString()} overage credits</span>
                ) : (
                  <span className="font-medium text-gray-700">{creditsLeft.toLocaleString()} credits left</span>
                )}
              </span>
              <span aria-hidden="true">·</span>
              <span>
                {c.cycleResetsAt
                  ? `Resets in ${resetDays} day${resetDays === 1 ? '' : 's'} (${formatDate(c.cycleResetsAt)})`
                  : 'Resets —'}
              </span>
              <span aria-hidden="true">·</span>
              <span>Overage: {c.planCurrency} {(c.overageUnitPriceMinor / 100).toFixed(2)} per credit</span>
            </div>
          </div>

          <div className="w-full shrink-0 lg:w-72">
            <p className="mb-2 text-xs font-medium uppercase tracking-wide text-gray-400">What used your credits</p>
            <ul className="space-y-2">
              {c.breakdown.map((b) => {
                const bpct = totalUsed > 0 ? Math.round((b.credits / totalUsed) * 100) : 0;
                return (
                  <li key={b.label} className="flex items-center justify-between gap-3 text-sm">
                    <span className="truncate text-gray-700">{b.label}</span>
                    <span className="shrink-0 tabular-nums text-gray-500">
                      {b.credits.toLocaleString()} <span className="text-gray-400">({bpct}%)</span>
                    </span>
                  </li>
                );
              })}
            </ul>
            <button
              type="button"
              onClick={() => router.push('/billing')}
              className="mt-3 inline-flex w-full items-center justify-center rounded-md border border-gray-300 bg-white px-3 py-2 text-sm font-medium text-gray-700 shadow-sm transition-colors hover:border-gray-400 hover:bg-gray-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary-600 focus-visible:ring-offset-2"
            >
              Manage plan and billing
            </button>
          </div>
        </div>
      </Card>

      {/* ── Listing pipeline ─────────────────────────────────────────────── */}
      <section aria-label="Listing pipeline">
        <h2 className="mb-2 text-sm font-semibold text-gray-900">Listing pipeline</h2>
        <div className="grid grid-cols-2 gap-3 lg:grid-cols-5">
          {STAGES.map(({ stage, count, note }) => {
            const highlight = stage === 'NEEDS_REVIEW';
            return (
              <div
                key={stage}
                className={`rounded-lg border p-4 shadow-sm ${highlight ? 'border-primary-200 bg-primary-50' : 'border-gray-200 bg-white'}`}
              >
                <p className={`text-xs font-medium ${highlight ? 'text-primary-700' : 'text-gray-500'}`}>{STAGE_LABEL[stage]}</p>
                <p className={`mt-1 text-2xl font-bold ${highlight ? 'text-primary-900' : 'text-gray-900'}`}>{count}</p>
                <p className={`text-xs ${highlight ? 'text-primary-600' : 'text-gray-400'}`}>{note}</p>
              </div>
            );
          })}
        </div>
      </section>

      {/* ── Needs review + Ready to download ─────────────────────────────── */}
      <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
        {/* Needs review */}
        <section aria-label="Batches needing review">
          <div className="mb-2 flex items-center justify-between">
            <div>
              <h2 className="text-sm font-semibold text-gray-900">Needs review</h2>
              <p className="text-xs text-gray-500">Generated listings awaiting your approval</p>
            </div>
            <button type="button" onClick={() => router.push('/review-queue')} className="text-sm font-medium text-primary-600 hover:text-primary-700">
              View all
            </button>
          </div>
          <div className="overflow-hidden rounded-lg border border-gray-200 bg-white">
            {REVIEW.length === 0 ? (
              <p className="px-4 py-6 text-center text-sm text-gray-500">Nothing to review.</p>
            ) : (
              <ul className="divide-y divide-gray-100">
                {REVIEW.map((b) => (
                  <li key={b.id} className="flex items-center justify-between gap-3 px-4 py-3">
                    <div className="min-w-0">
                      <p className="truncate text-sm font-medium text-gray-900">{b.batchName}</p>
                      <p className="truncate text-xs text-gray-500">{b.productCount} products · {b.marketplaces.join(', ')}</p>
                    </div>
                    <button
                      type="button"
                      onClick={() => router.push(`/review-queue/${b.id}`)}
                      className="shrink-0 rounded-md bg-primary-600 px-3 py-1.5 text-xs font-semibold text-white shadow-sm transition-colors hover:bg-primary-700 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary-600 focus-visible:ring-offset-2"
                    >
                      Review
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </div>
        </section>

        {/* Ready to download */}
        <section aria-label="Batches ready to download">
          <div className="mb-2 flex items-center justify-between">
            <div>
              <h2 className="text-sm font-semibold text-gray-900">Ready to download</h2>
              <p className="text-xs text-gray-500">Approved. Product CSV generated per marketplace.</p>
            </div>
            <button type="button" onClick={() => router.push('/exports')} className="text-sm font-medium text-primary-600 hover:text-primary-700">
              All exports
            </button>
          </div>
          <div className="overflow-hidden rounded-lg border border-gray-200 bg-white">
            {READY.length === 0 ? (
              <p className="px-4 py-6 text-center text-sm text-gray-500">No CSVs ready yet.</p>
            ) : (
              <ul className="divide-y divide-gray-100">
                {READY.map((b) => (
                  <li key={b.id} className="flex items-center justify-between gap-3 px-4 py-3">
                    <div className="min-w-0">
                      <p className="truncate text-sm font-medium text-gray-900">{b.batchName}</p>
                      <p className="truncate text-xs text-gray-500">{b.productCount} products · {b.marketplaces.join(', ')}</p>
                    </div>
                    <div className="flex shrink-0 flex-wrap justify-end gap-1.5">
                      {b.marketplaces.map((mp) => (
                        <button
                          key={mp}
                          type="button"
                          onClick={() => router.push(`/exports/${b.id}?marketplace=${encodeURIComponent(mp)}`)}
                          className="inline-flex items-center gap-1.5 rounded-md border border-gray-300 bg-white px-2.5 py-1.5 text-xs font-medium text-gray-700 shadow-sm transition-colors hover:border-gray-400 hover:bg-gray-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary-600"
                          title={`Download ${mp} Product CSV`}
                        >
                          <DownloadIcon />
                          {mp} Product CSV
                        </button>
                      ))}
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </div>
          <p className="mt-2 text-xs text-gray-400">
            MerchOS creates your product listing file. Set price, stock, and lead time on the marketplace after uploading.
          </p>
        </section>
      </div>

      {/* ── Recent activity ──────────────────────────────────────────────── */}
      <section aria-label="Recent activity">
        <div className="mb-2 flex items-center justify-between">
          <div>
            <h2 className="text-sm font-semibold text-gray-900">Recent activity</h2>
            <p className="text-xs text-gray-500">Latest batch updates</p>
          </div>
          <button type="button" onClick={() => router.push('/products')} className="text-sm font-medium text-primary-600 hover:text-primary-700">
            View all
          </button>
        </div>
        <DataTable
          columns={activityColumns}
          data={ACTIVITY}
          getRowKey={(r) => r.id}
          onRowClick={(r) => router.push(`/products?batch=${r.id}`)}
          emptyMessage="No activity yet."
          caption="Recent batch activity"
        />
      </section>

    </div>
  );
}

// ─── Icons (monochrome, thin stroke, no emoji) ──────────────────────────────────

function PlusIcon() {
  return (<svg xmlns="http://www.w3.org/2000/svg" className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" aria-hidden="true"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 5v14M5 12h14" /></svg>);
}
function ChevronIcon() {
  return (<svg xmlns="http://www.w3.org/2000/svg" className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" aria-hidden="true"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" /></svg>);
}
function DownloadIcon() {
  return (<svg xmlns="http://www.w3.org/2000/svg" className="h-3.5 w-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" aria-hidden="true"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.8} d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4" /></svg>);
}
