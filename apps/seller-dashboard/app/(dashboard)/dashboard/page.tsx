'use client';

/**
 * Seller Intelligence Dashboard
 *
 * Centralised listing analytics for the seller: summary metrics, a product
 * import entry point, and tables surfacing listings that need attention and
 * recent listing activity.
 *
 * NOTE: This is a MOCK built against clearly-labelled demonstration data
 * (see DEMO_* constants and the "Demonstration data" banner). Every control is
 * already functional — filters narrow the rendered rows, the import controls
 * route into the real /imports flow and accept dropped files, and the tables
 * use the shared DataTable primitive with sorting/pagination. When the backend
 * listing-analytics endpoints land, replace the DEMO_* sources and the
 * in-memory filtering with the live queries; the component shape stays the same.
 *
 * Palette: MerchOS slate (`sidebar.*`) + `primary` blue from tailwind.config.ts.
 * No decorative colour, no emoji — a restrained, professional surface.
 */

import React, { useMemo, useState, useCallback } from 'react';
import { useRouter } from 'next/navigation';
import { Card, StatCard, Badge, DataTable, Select, FileUpload, Alert, useToast } from '@merch-os/ui';
import type { ColumnDef, SelectOption, SortDirection, BadgeVariant } from '@merch-os/ui';

// ─── Domain types (mock shape; mirrors the intended listing-analytics model) ──

type ListingStatus =
  | 'DRAFT'
  | 'PROCESSING'
  | 'READY_FOR_EXPORT'
  | 'EXPORTED'
  | 'NEEDS_ATTENTION';

type InputSource =
  | 'CSV / Excel'
  | 'PDF Documents'
  | 'Product Images'
  | 'Manual Entry'
  | 'Supplier URLs';

interface AttentionListing {
  id: string;
  productName: string;
  sku: string;
  marketplace: string;
  errorCategory: string;
  updatedAt: string;
}

interface ActivityListing {
  id: string;
  productTitle: string;
  reference: string;
  marketplace: string;
  inputSource: InputSource;
  status: ListingStatus;
  createdAt: string;
  updatedAt: string;
}

// ─── Status presentation ──────────────────────────────────────────────────────

const STATUS_LABELS: Record<ListingStatus, string> = {
  DRAFT: 'Draft',
  PROCESSING: 'Processing',
  READY_FOR_EXPORT: 'Ready for Export',
  EXPORTED: 'Exported',
  NEEDS_ATTENTION: 'Needs Attention',
};

// Restrained, on-brand mapping. Only genuine states carry an accent; the rest
// stay neutral so the surface reads as serious rather than colourful.
const STATUS_VARIANT: Record<ListingStatus, BadgeVariant> = {
  DRAFT: 'neutral',
  PROCESSING: 'info',
  READY_FOR_EXPORT: 'info',
  EXPORTED: 'success',
  NEEDS_ATTENTION: 'warning',
};

function StatusBadge({ status }: { status: ListingStatus }) {
  return <Badge variant={STATUS_VARIANT[status]}>{STATUS_LABELS[status]}</Badge>;
}

// ─── Filter option sets ────────────────────────────────────────────────────────

const MARKETPLACE_OPTIONS: SelectOption[] = [
  { value: 'all', label: 'All Marketplaces' },
  { value: 'Takealot', label: 'Takealot' },
  { value: 'Amazon', label: 'Amazon' },
  { value: 'Shopify', label: 'Shopify' },
  { value: 'Makro', label: 'Makro' },
  { value: 'WooCommerce', label: 'WooCommerce' },
  { value: 'eBay', label: 'eBay' },
  { value: 'Etsy', label: 'Etsy' },
];

const STATUS_OPTIONS: SelectOption[] = [
  { value: 'all', label: 'All Statuses' },
  { value: 'DRAFT', label: 'Draft' },
  { value: 'PROCESSING', label: 'Processing' },
  { value: 'READY_FOR_EXPORT', label: 'Ready for Export' },
  { value: 'EXPORTED', label: 'Exported' },
  { value: 'NEEDS_ATTENTION', label: 'Needs Attention' },
];

const SOURCE_OPTIONS: SelectOption[] = [
  { value: 'all', label: 'All Input Sources' },
  { value: 'CSV / Excel', label: 'CSV / Excel' },
  { value: 'PDF Documents', label: 'PDF Documents' },
  { value: 'Product Images', label: 'Product Images' },
  { value: 'Manual Entry', label: 'Manual Entry' },
  { value: 'Supplier URLs', label: 'Supplier URLs' },
];

// ─── Demonstration data ────────────────────────────────────────────────────────
// Clearly labelled sample data for the initial design. Replace with live
// listing-analytics queries when the backend endpoints are available.

const DEMO_METRICS = {
  totalProducts: 200,
  draft: 39,
  processing: 39,
  readyForExport: 50,
  exported: 40,
  needsAttention: 32,
  totalTrend: '+12%',
  exportedTrend: '+8%',
} as const;

const DEMO_ATTENTION: AttentionListing[] = [
  { id: 'a1', productName: 'Car Phone Mount v3', sku: 'SKU-18119', marketplace: 'Takealot', errorCategory: 'Description Too Short', updatedAt: '2026-10-19' },
  { id: 'a2', productName: 'Folding Camping Chair v3', sku: 'SKU-18137', marketplace: 'Etsy', errorCategory: 'Price Mismatch', updatedAt: '2026-09-22' },
  { id: 'a3', productName: 'Ceramic Coffee Mug Set v2', sku: 'SKU-18062', marketplace: 'Makro', errorCategory: 'Description Too Short', updatedAt: '2026-09-09' },
  { id: 'a4', productName: 'Wireless Bluetooth Headphones v2', sku: 'SKU-18050', marketplace: 'Amazon', errorCategory: 'Missing Images', updatedAt: '2026-08-08' },
  { id: 'a5', productName: 'Essential Oil Set 6pk', sku: 'SKU-18018', marketplace: 'Etsy', errorCategory: 'Missing Images', updatedAt: '2026-07-22' },
  { id: 'a6', productName: 'Thermal Insulated Lunch Bag v4', sku: 'SKU-18173', marketplace: 'Amazon', errorCategory: 'Invalid SKU', updatedAt: '2026-07-18' },
  { id: 'a7', productName: 'Stainless Steel Cookware Set v2', sku: 'SKU-18065', marketplace: 'Amazon', errorCategory: 'Price Mismatch', updatedAt: '2026-07-16' },
  { id: 'a8', productName: 'Memory Foam Pillow v2', sku: 'SKU-18066', marketplace: 'Amazon', errorCategory: 'Weight Missing', updatedAt: '2026-07-04' },
  { id: 'a9', productName: 'Microfibre Cleaning Cloths 12pk v2', sku: 'SKU-18083', marketplace: 'eBay', errorCategory: 'Description Too Short', updatedAt: '2026-06-25' },
  { id: 'a10', productName: 'LED Desk Lamp Pro', sku: 'SKU-18003', marketplace: 'Etsy', errorCategory: 'Missing Images', updatedAt: '2026-06-21' },
  { id: 'a11', productName: 'Portable Bluetooth Speaker v2', sku: 'SKU-18091', marketplace: 'eBay', errorCategory: 'Invalid SKU', updatedAt: '2026-04-14' },
  { id: 'a12', productName: 'Solar Garden Lights 6pk v4', sku: 'SKU-18194', marketplace: 'eBay', errorCategory: 'Category Error', updatedAt: '2026-04-04' },
  { id: 'a13', productName: 'Stainless Steel Water Bottle', sku: 'SKU-18081', marketplace: 'eBay', errorCategory: 'Missing Images', updatedAt: '2026-03-06' },
  { id: 'a14', productName: 'USB-C Hub 7-in-1', sku: 'SKU-18030', marketplace: 'WooCommerce', errorCategory: 'Missing Images', updatedAt: '2026-02-22' },
  { id: 'a15', productName: 'Reusable Produce Bags v2', sku: 'SKU-18085', marketplace: 'eBay', errorCategory: 'Category Error', updatedAt: '2026-01-20' },
  { id: 'a16', productName: 'Car Phone Mount v4', sku: 'SKU-18109', marketplace: 'Takealot', errorCategory: 'Missing Images', updatedAt: '2026-01-20' },
  { id: 'a17', productName: 'Portable Power Bank 20000mAh v3', sku: 'SKU-18107', marketplace: 'eBay', errorCategory: 'Description Too Short', updatedAt: '2025-12-10' },
  { id: 'a18', productName: 'Digital Meat Thermometer v4', sku: 'SKU-18196', marketplace: 'Amazon', errorCategory: 'Price Mismatch', updatedAt: '2025-12-08' },
  { id: 'a19', productName: 'Ceramic Coffee Mug Set', sku: 'SKU-18012', marketplace: 'Shopify', errorCategory: 'Category Error', updatedAt: '2025-12-07' },
  { id: 'a20', productName: 'Portable Bluetooth Speaker', sku: 'SKU-18041', marketplace: 'Makro', errorCategory: 'Invalid SKU', updatedAt: '2025-11-09' },
];

const DEMO_ACTIVITY: ActivityListing[] = [
  { id: 'r1', productTitle: 'Phone Screen Protector 3pk v2', reference: 'PRD-8087', marketplace: 'eBay', inputSource: 'CSV / Excel', status: 'READY_FOR_EXPORT', createdAt: '2026-10-25', updatedAt: '2026-10-27' },
  { id: 'r2', productTitle: 'Kids Building Blocks 500pc v3', reference: 'PRD-8118', marketplace: 'WooCommerce', inputSource: 'Product Images', status: 'EXPORTED', createdAt: '2026-10-24', updatedAt: '2026-10-27' },
  { id: 'r3', productTitle: 'Ceramic Coffee Mug Set v4', reference: 'PRD-8163', marketplace: 'WooCommerce', inputSource: 'Manual Entry', status: 'PROCESSING', createdAt: '2026-10-23', updatedAt: '2026-10-25' },
  { id: 'r4', productTitle: 'Portable Power Bank 20000mAh', reference: 'PRD-8008', marketplace: 'Takealot', inputSource: 'Manual Entry', status: 'DRAFT', createdAt: '2026-10-19', updatedAt: '2026-10-23' },
  { id: 'r5', productTitle: 'Car Phone Mount v3', reference: 'PRD-8120', marketplace: 'Takealot', inputSource: 'PDF Documents', status: 'NEEDS_ATTENTION', createdAt: '2026-10-19', updatedAt: '2026-10-19' },
  { id: 'r6', productTitle: 'Acacia Wood Serving Board v3', reference: 'PRD-8149', marketplace: 'Takealot', inputSource: 'PDF Documents', status: 'DRAFT', createdAt: '2026-10-12', updatedAt: '2026-10-19' },
  { id: 'r7', productTitle: 'Running Shoes Ultra v4', reference: 'PRD-8156', marketplace: 'Takealot', inputSource: 'CSV / Excel', status: 'READY_FOR_EXPORT', createdAt: '2026-10-11', updatedAt: '2026-10-13' },
  { id: 'r8', productTitle: 'Weighted Jump Rope v2', reference: 'PRD-8094', marketplace: 'Takealot', inputSource: 'Product Images', status: 'PROCESSING', createdAt: '2026-10-09', updatedAt: '2026-10-13' },
  { id: 'r9', productTitle: 'Wireless Bluetooth Headphones v4', reference: 'PRD-8151', marketplace: 'eBay', inputSource: 'Supplier URLs', status: 'EXPORTED', createdAt: '2026-09-30', updatedAt: '2026-10-03' },
  { id: 'r10', productTitle: 'Wireless Charging Pad v2', reference: 'PRD-8065', marketplace: 'Takealot', inputSource: 'Manual Entry', status: 'PROCESSING', createdAt: '2026-09-30', updatedAt: '2026-10-01' },
  { id: 'r11', productTitle: 'Memory Foam Pillow', reference: 'PRD-8017', marketplace: 'Shopify', inputSource: 'Product Images', status: 'EXPORTED', createdAt: '2026-09-25', updatedAt: '2026-09-25' },
  { id: 'r12', productTitle: 'Weighted Jump Rope', reference: 'PRD-8044', marketplace: 'Amazon', inputSource: 'PDF Documents', status: 'PROCESSING', createdAt: '2026-09-23', updatedAt: '2026-09-23' },
  { id: 'r13', productTitle: 'Folding Camping Chair v3', reference: 'PRD-8138', marketplace: 'Etsy', inputSource: 'Product Images', status: 'NEEDS_ATTENTION', createdAt: '2026-09-19', updatedAt: '2026-09-22' },
  { id: 'r14', productTitle: 'Solar Garden Lights 6pk v3', reference: 'PRD-8145', marketplace: 'Etsy', inputSource: 'CSV / Excel', status: 'READY_FOR_EXPORT', createdAt: '2026-09-13', updatedAt: '2026-09-18' },
  { id: 'r15', productTitle: 'Ceramic Coffee Mug Set v2', reference: 'PRD-8063', marketplace: 'Makro', inputSource: 'Supplier URLs', status: 'NEEDS_ATTENTION', createdAt: '2026-09-11', updatedAt: '2026-09-16' },
];

const ACTIVITY_PAGE_SIZE = 15;

// ─── Helpers ────────────────────────────────────────────────────────────────

function formatDate(dateStr: string): string {
  try {
    return new Intl.DateTimeFormat('en-GB', { dateStyle: 'medium' }).format(new Date(dateStr));
  } catch {
    return dateStr;
  }
}

function todayIso(): string {
  return new Date().toISOString().slice(0, 10);
}

// ─── Page ─────────────────────────────────────────────────────────────────────

export default function DashboardPage() {
  const router = useRouter();
  const { toast } = useToast();

  // Filters
  const [marketplace, setMarketplace] = useState('all');
  const [status, setStatus] = useState('all');
  const [source, setSource] = useState('all');
  const [fromDate, setFromDate] = useState('2025-07-01');
  const [toDate, setToDate] = useState(todayIso());

  // Table paging / sorting
  const [activityPage, setActivityPage] = useState(1);
  const [activitySort, setActivitySort] = useState<{ col: string | null; dir: SortDirection }>({
    col: 'createdAt',
    dir: 'desc',
  });

  const lastRefreshed = useMemo(
    () => new Intl.DateTimeFormat('en-GB', { dateStyle: 'medium', timeStyle: 'short' }).format(new Date()),
    []
  );

  // ── Filtering (client-side over demo data; swap for server queries later) ──
  const withinRange = useCallback(
    (dateStr: string) => {
      const d = dateStr.slice(0, 10);
      return (!fromDate || d >= fromDate) && (!toDate || d <= toDate);
    },
    [fromDate, toDate]
  );

  const attentionRows = useMemo(
    () =>
      DEMO_ATTENTION.filter(
        (r) =>
          (marketplace === 'all' || r.marketplace === marketplace) &&
          (status === 'all' || status === 'NEEDS_ATTENTION') &&
          withinRange(r.updatedAt)
      ),
    [marketplace, status, withinRange]
  );

  const activityRowsAll = useMemo(() => {
    const filtered = DEMO_ACTIVITY.filter(
      (r) =>
        (marketplace === 'all' || r.marketplace === marketplace) &&
        (status === 'all' || r.status === status) &&
        (source === 'all' || r.inputSource === source) &&
        withinRange(r.createdAt)
    );

    const { col, dir } = activitySort;
    if (!col || !dir) return filtered;
    const sorted = [...filtered].sort((a, b) => {
      const av = String((a as unknown as Record<string, unknown>)[col] ?? '');
      const bv = String((b as unknown as Record<string, unknown>)[col] ?? '');
      return av < bv ? -1 : av > bv ? 1 : 0;
    });
    return dir === 'asc' ? sorted : sorted.reverse();
  }, [marketplace, status, source, withinRange, activitySort]);

  const activityRows = useMemo(() => {
    const start = (activityPage - 1) * ACTIVITY_PAGE_SIZE;
    return activityRowsAll.slice(start, start + ACTIVITY_PAGE_SIZE);
  }, [activityRowsAll, activityPage]);

  const resetPaging = useCallback(() => setActivityPage(1), []);

  // ── Import handlers (functional entry points into the real /imports flow) ──
  const goToImports = useCallback(
    (sourceHint?: string) => {
      router.push(sourceHint ? `/imports?source=${encodeURIComponent(sourceHint)}` : '/imports');
    },
    [router]
  );

  const handleFilesSelected = useCallback(
    (files: File[]) => {
      toast({
        title: files.length > 1 ? `${files.length} files received` : 'File received',
        description: 'Continue in the import workspace to start the job.',
        variant: 'info',
      });
      router.push('/imports');
    },
    [router, toast]
  );

  // ── Column definitions ─────────────────────────────────────────────────────
  const attentionColumns: ColumnDef<AttentionListing>[] = useMemo(
    () => [
      { id: 'productName', header: 'Product Name', cell: (r) => <span className="font-medium text-gray-900">{r.productName}</span> },
      { id: 'sku', header: 'SKU', cell: (r) => <span className="font-mono text-xs text-gray-600">{r.sku}</span> },
      { id: 'marketplace', header: 'Marketplace', cell: (r) => r.marketplace },
      { id: 'status', header: 'Status', cell: () => <StatusBadge status="NEEDS_ATTENTION" /> },
      { id: 'errorCategory', header: 'Error Category', cell: (r) => <span className="text-gray-700">{r.errorCategory}</span> },
      { id: 'updatedAt', header: 'Last Updated', cell: (r) => <span className="text-gray-500">{formatDate(r.updatedAt)}</span> },
    ],
    []
  );

  const activityColumns: ColumnDef<ActivityListing>[] = useMemo(
    () => [
      { id: 'productTitle', header: 'Product Title', sortable: true, cell: (r) => <span className="font-medium text-gray-900">{r.productTitle}</span> },
      { id: 'reference', header: 'Reference', cell: (r) => <span className="font-mono text-xs text-gray-600">{r.reference}</span> },
      { id: 'marketplace', header: 'Marketplace', sortable: true, cell: (r) => r.marketplace },
      { id: 'inputSource', header: 'Input Source', cell: (r) => <span className="text-gray-600">{r.inputSource}</span> },
      { id: 'status', header: 'Status', sortable: true, cell: (r) => <StatusBadge status={r.status} /> },
      { id: 'createdAt', header: 'Created', sortable: true, cell: (r) => <span className="text-gray-500">{formatDate(r.createdAt)}</span> },
      { id: 'updatedAt', header: 'Updated', sortable: true, cell: (r) => <span className="text-gray-500">{formatDate(r.updatedAt)}</span> },
    ],
    []
  );

  const handleActivitySort = useCallback((columnId: string, direction: SortDirection) => {
    setActivitySort({ col: direction ? columnId : null, dir: direction });
    setActivityPage(1);
  }, []);

  return (
    <div className="space-y-6 p-6">
      {/* ── Header ──────────────────────────────────────────────────────── */}
      <header className="rounded-lg border border-gray-200 bg-sidebar-bg px-6 py-5 text-white shadow-sm">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div className="flex items-center gap-3">
            <div className="flex h-10 w-10 items-center justify-center rounded-md bg-white/10 text-lg font-semibold tracking-tight">
              M
            </div>
            <div>
              <h1 className="text-lg font-semibold tracking-tight">Seller Intelligence Dashboard</h1>
              <p className="text-sm text-gray-300">MerchOS · Centralised listing analytics</p>
            </div>
          </div>
          <div className="text-right text-sm text-gray-300">
            <p className="font-medium text-white">{DEMO_METRICS.totalProducts} total records</p>
            <p>Last refreshed {lastRefreshed}</p>
          </div>
        </div>

        {/* Filters */}
        <div className="mt-5 grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-5">
          <FilterSelect label="Marketplace" value={marketplace} options={MARKETPLACE_OPTIONS} onChange={(v) => { setMarketplace(v); resetPaging(); }} />
          <FilterSelect label="Status" value={status} options={STATUS_OPTIONS} onChange={(v) => { setStatus(v); resetPaging(); }} />
          <FilterSelect label="Input Source" value={source} options={SOURCE_OPTIONS} onChange={(v) => { setSource(v); resetPaging(); }} />
          <DateField label="From" value={fromDate} onChange={(v) => { setFromDate(v); resetPaging(); }} />
          <DateField label="To" value={toDate} onChange={(v) => { setToDate(v); resetPaging(); }} />
        </div>
      </header>

      {/* ── Demonstration banner ────────────────────────────────────────── */}
      <Alert variant="warning" title="Demonstration data">
        <p className="text-sm">
          This dashboard uses clearly-labelled sample data for the initial design. Connect your
          MerchOS data source for production analytics.
        </p>
      </Alert>

      {/* ── Summary metrics ─────────────────────────────────────────────── */}
      <section aria-label="Summary metrics">
        <div className="grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-6">
          <StatCard label="Total Products" value={DEMO_METRICS.totalProducts} description={`${DEMO_METRICS.totalTrend} vs last period`} trend="up" icon={<PackageIcon />} />
          <StatCard label="Draft Listings" value={DEMO_METRICS.draft} icon={<DraftIcon />} />
          <StatCard label="Processing" value={DEMO_METRICS.processing} icon={<ProcessingIcon />} />
          <StatCard label="Ready for Export" value={DEMO_METRICS.readyForExport} icon={<CheckIcon />} />
          <StatCard label="Exported" value={DEMO_METRICS.exported} description={`${DEMO_METRICS.exportedTrend} vs last period`} trend="up" icon={<ExportIcon />} />
          <StatCard label="Needs Attention" value={DEMO_METRICS.needsAttention} icon={<AttentionIcon />} />
        </div>
      </section>

      {/* ── Import Products ─────────────────────────────────────────────── */}
      <Card>
        <div className="mb-4 flex items-center gap-2">
          <ImportIcon />
          <h2 className="text-sm font-semibold text-gray-900">Import Products</h2>
        </div>
        <p className="mb-4 text-sm text-gray-500">
          Upload product files to create marketplace listings. Supports CSV, Excel, PDF, and images.
        </p>

        <div className="mb-4 flex flex-wrap gap-2">
          <ImportButton label="CSV / Excel" onClick={() => goToImports('FILE_CSV')} icon={<SheetIcon />} />
          <ImportButton label="PDF Documents" onClick={() => goToImports('FILE_PDF')} icon={<DocIcon />} />
          <ImportButton label="Product Images" onClick={() => goToImports('IMAGE')} icon={<ImageIcon />} />
          <ImportButton label="Any File" onClick={() => goToImports()} icon={<FileIcon />} />
        </div>

        <FileUpload
          aria-label="Drag and drop product files to import"
          multiple
          acceptedTypes={['text/csv', 'application/vnd.ms-excel', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', 'application/pdf', 'image/*']}
          hint="CSV, Excel, PDF, or images · up to 10 MB each"
          onFilesSelected={handleFilesSelected}
        />

        <div className="mt-4 flex justify-end">
          <button
            type="button"
            onClick={() => goToImports()}
            className="inline-flex items-center gap-2 rounded-md bg-primary-600 px-4 py-2 text-sm font-semibold text-white shadow-sm transition-colors hover:bg-primary-700 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary-600 focus-visible:ring-offset-2"
          >
            <PlayIcon />
            Start Job
          </button>
        </div>
      </Card>

      {/* ── Listings Requiring Attention ────────────────────────────────── */}
      <section aria-label="Listings requiring attention">
        <div className="mb-2 flex items-center justify-between">
          <div>
            <h2 className="text-sm font-semibold text-gray-900">Listings Requiring Attention</h2>
            <p className="text-xs text-gray-500">Failed or incomplete listings needing intervention</p>
          </div>
          <Badge variant="warning">{attentionRows.length} items</Badge>
        </div>
        <DataTable
          columns={attentionColumns}
          data={attentionRows}
          getRowKey={(r) => r.id}
          onRowClick={(r) => router.push(`/products?sku=${encodeURIComponent(r.sku)}`)}
          emptyMessage="No listings require attention for the selected filters."
          caption="Listings requiring attention"
        />
      </section>

      {/* ── Recent Listing Activity ─────────────────────────────────────── */}
      <section aria-label="Recent listing activity">
        <div className="mb-2 flex items-center justify-between">
          <div>
            <h2 className="text-sm font-semibold text-gray-900">Recent Listing Activity</h2>
            <p className="text-xs text-gray-500">Latest product listing records</p>
          </div>
          <span className="text-xs text-gray-500">{activityRowsAll.length} listings</span>
        </div>
        <DataTable
          columns={activityColumns}
          data={activityRows}
          getRowKey={(r) => r.id}
          sortColumn={activitySort.col}
          sortDirection={activitySort.dir}
          onSort={handleActivitySort}
          onRowClick={(r) => router.push(`/products?ref=${encodeURIComponent(r.reference)}`)}
          page={activityPage}
          pageSize={ACTIVITY_PAGE_SIZE}
          totalItems={activityRowsAll.length}
          onPageChange={setActivityPage}
          emptyMessage="No listing activity for the selected filters."
          caption="Recent listing activity"
        />
      </section>

      <footer className="pt-2 text-center text-xs text-gray-400">
        MerchOS Seller Intelligence Dashboard · Demonstration data · {new Date().getFullYear()}
      </footer>
    </div>
  );
}

// ─── Local presentational helpers ──────────────────────────────────────────────

/** Select styled for the dark header strip (overrides the light default). */
function FilterSelect({
  label,
  value,
  options,
  onChange,
}: {
  label: string;
  value: string;
  options: SelectOption[];
  onChange: (v: string) => void;
}) {
  return (
    <div className="[&_label]:text-gray-300">
      <Select label={label} value={value} options={options} onValueChange={onChange} />
    </div>
  );
}

function DateField({ label, value, onChange }: { label: string; value: string; onChange: (v: string) => void }) {
  return (
    <div className="flex flex-col gap-1.5">
      <label className="text-sm font-medium text-gray-300">{label}</label>
      <input
        type="date"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className="rounded-md border border-gray-300 bg-white px-3 py-2 text-sm text-gray-900 shadow-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary-600 focus-visible:ring-offset-2"
      />
    </div>
  );
}

function ImportButton({ label, onClick, icon }: { label: string; onClick: () => void; icon: React.ReactNode }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="inline-flex items-center gap-2 rounded-md border border-gray-300 bg-white px-3 py-2 text-sm font-medium text-gray-700 shadow-sm transition-colors hover:border-gray-400 hover:bg-gray-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary-600 focus-visible:ring-offset-2"
    >
      <span className="text-gray-500" aria-hidden="true">{icon}</span>
      {label}
    </button>
  );
}

// ─── Icons (monochrome, thin stroke — no colour, no emoji) ──────────────────────

function iconProps(size = 'h-5 w-5') {
  return {
    xmlns: 'http://www.w3.org/2000/svg',
    className: size,
    fill: 'none',
    viewBox: '0 0 24 24',
    stroke: 'currentColor',
    'aria-hidden': true as const,
  };
}

function PackageIcon() {
  return (<svg {...iconProps()}><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.8} d="M20 7l-8-4-8 4m16 0l-8 4m8-4v10l-8 4m0-10L4 7m8 4v10M4 7v10l8 4" /></svg>);
}
function DraftIcon() {
  return (<svg {...iconProps()}><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.8} d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z" /></svg>);
}
function ProcessingIcon() {
  return (<svg {...iconProps()}><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.8} d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" /></svg>);
}
function CheckIcon() {
  return (<svg {...iconProps()}><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.8} d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z" /></svg>);
}
function ExportIcon() {
  return (<svg {...iconProps()}><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.8} d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-8l-4-4m0 0L8 8m4-4v12" /></svg>);
}
function AttentionIcon() {
  return (<svg {...iconProps()}><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.8} d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-2.5L13.732 4c-.77-.833-1.964-.833-2.732 0L4.082 16.5c-.77.833.192 2.5 1.732 2.5z" /></svg>);
}
function ImportIcon() {
  return (<svg {...iconProps('h-5 w-5 text-gray-700')}><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.8} d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4" /></svg>);
}
function SheetIcon() {
  return (<svg {...iconProps('h-4 w-4')}><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.8} d="M9 17v-2m3 2v-4m3 4v-6M5 4h14a1 1 0 011 1v14a1 1 0 01-1 1H5a1 1 0 01-1-1V5a1 1 0 011-1z" /></svg>);
}
function DocIcon() {
  return (<svg {...iconProps('h-4 w-4')}><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.8} d="M7 21h10a2 2 0 002-2V9.414a1 1 0 00-.293-.707l-5.414-5.414A1 1 0 0012.586 3H7a2 2 0 00-2 2v14a2 2 0 002 2z" /></svg>);
}
function ImageIcon() {
  return (<svg {...iconProps('h-4 w-4')}><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.8} d="M4 16l4.586-4.586a2 2 0 012.828 0L16 16m-2-2l1.586-1.586a2 2 0 012.828 0L20 14m-6-6h.01M6 20h12a2 2 0 002-2V6a2 2 0 00-2-2H6a2 2 0 00-2 2v12a2 2 0 002 2z" /></svg>);
}
function FileIcon() {
  return (<svg {...iconProps('h-4 w-4')}><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.8} d="M7 21h10a2 2 0 002-2V9.414a1 1 0 00-.293-.707l-5.414-5.414A1 1 0 0012.586 3H7a2 2 0 00-2 2v14a2 2 0 002 2z" /></svg>);
}
function PlayIcon() {
  return (<svg {...iconProps('h-4 w-4')}><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.8} d="M14.752 11.168l-3.197-2.132A1 1 0 0010 9.87v4.263a1 1 0 001.555.832l3.197-2.132a1 1 0 000-1.664z" /><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.8} d="M21 12a9 9 0 11-18 0 9 9 0 0118 0z" /></svg>);
}
