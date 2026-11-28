'use client';

/**
 * Exports: make an import file for Takealot, Shopify or WooCommerce from up to
 * 500 products. The server loads the products, checks them against the chosen
 * store's rules (Ready / Needs fixing), builds the file with working image
 * links (7 days), and keeps it in the export history.
 *
 * Products ticked on the Products page arrive here through sessionStorage
 * (EXPORT_SELECTION_KEY), since 500 ids do not fit in a web address.
 */

import React, { useEffect, useMemo, useState } from 'react';
import { Card, Alert, Badge, useToast } from '@merch-os/ui';
import {
  useProducts,
  useCheckChannelExport,
  useCreateChannelExport,
  useExportHistory,
  useExportDownloadLink,
  useSaveChannelCategory,
  useShopifyCategorySearch,
  type ChannelExportCheck,
  type ChannelExportOptions,
  type ExportChannel,
  type ProductExportCheck,
} from '@merch-os/api-client';

import { EXPORT_SELECTION_KEY } from './selection';

const MAX_PRODUCTS = 500;

const STORES: Array<{ id: ExportChannel | 'makro' | 'amazon'; name: string; note: string; soon?: boolean }> = [
  { id: 'takealot', name: 'Takealot', note: 'Loadsheet for one Takealot category' },
  { id: 'shopify', name: 'Shopify', note: 'Product CSV for Products > Import' },
  { id: 'woocommerce', name: 'WooCommerce', note: 'Product CSV for the WooCommerce importer' },
  { id: 'makro', name: 'Makro', note: 'Coming soon', soon: true },
  { id: 'amazon', name: 'Amazon', note: 'Coming soon', soon: true },
];

const STORE_NAME: Record<ExportChannel, string> = { takealot: 'Takealot', shopify: 'Shopify', woocommerce: 'WooCommerce' };

function formatDateTime(iso: string): string {
  try {
    return new Intl.DateTimeFormat('en-ZA', { dateStyle: 'medium', timeStyle: 'short' }).format(new Date(iso));
  } catch {
    return iso;
  }
}

function go(url: string): void {
  window.location.assign(url);
}

// ─── Shopify category picker ─────────────────────────────────────────────────

function ShopifyCategoryPicker({ product, onSaved }: { product: ProductExportCheck; onSaved: () => void }) {
  const [query, setQuery] = useState('');
  const search = useShopifyCategorySearch(query);
  const save = useSaveChannelCategory();
  const toast = useToast();
  const id = `shopify-cat-${product.productId}`;

  const choose = async (value: string | null) => {
    try {
      await save.mutateAsync({ productId: product.productId, channel: 'shopify', value });
      setQuery('');
      onSaved();
    } catch {
      toast.toast({ variant: 'error', title: 'The category could not be saved' });
    }
  };

  return (
    <div className="mt-2 space-y-1">
      <p className="text-xs text-gray-600">
        Shopify category:{' '}
        <span className="font-medium text-gray-900">{product.shopifyCategoryPath ?? 'none (optional)'}</span>
        {product.shopifyCategory && (
          <button type="button" className="ml-2 text-xs text-gray-500 underline" onClick={() => choose(null)} disabled={save.isPending}>
            Clear
          </button>
        )}
      </p>
      <label htmlFor={id} className="sr-only">
        Search Shopify categories for {product.title}
      </label>
      <input
        id={id}
        type="search"
        value={query}
        onChange={(e) => setQuery(e.target.value)}
        placeholder={product.categoryPath ? `Search, e.g. ${product.categoryPath.split('>').pop()!.trim()}` : 'Search Shopify categories'}
        className="w-full rounded-md border border-gray-300 px-2 py-1 text-xs"
      />
      {query.trim().length >= 2 && (
        <ul className="max-h-40 overflow-y-auto rounded-md border border-gray-200 bg-white text-xs" role="listbox" aria-label="Shopify categories">
          {search.isLoading && <li className="p-2 text-gray-500">Searching…</li>}
          {search.data?.length === 0 && <li className="p-2 text-gray-500">No Shopify category matches.</li>}
          {search.data?.map((c) => (
            <li key={c.id}>
              <button
                type="button"
                role="option"
                aria-selected={false}
                onClick={() => choose(c.id)}
                disabled={save.isPending}
                className="w-full px-2 py-1 text-left hover:bg-gray-50 focus-visible:bg-gray-100 focus-visible:outline-none"
              >
                {c.path}
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

// ─── WooCommerce category ────────────────────────────────────────────────────

function WooCategoryField({ product, onSaved }: { product: ProductExportCheck; onSaved: () => void }) {
  const [value, setValue] = useState(product.woocommerceCategory ?? '');
  const save = useSaveChannelCategory();
  const toast = useToast();
  const id = `woo-cat-${product.productId}`;

  useEffect(() => setValue(product.woocommerceCategory ?? ''), [product.woocommerceCategory]);

  const submit = async () => {
    try {
      await save.mutateAsync({ productId: product.productId, channel: 'woocommerce', value: value.trim() || null });
      onSaved();
    } catch {
      toast.toast({ variant: 'error', title: 'The category could not be saved' });
    }
  };

  return (
    <div className="mt-2">
      <label htmlFor={id} className="text-xs text-gray-600">
        WooCommerce category (use &gt; between levels)
      </label>
      <div className="mt-1 flex gap-2">
        <input
          id={id}
          type="text"
          value={value}
          onChange={(e) => setValue(e.target.value)}
          placeholder={product.categoryPath ?? 'e.g. Kitchen > Mugs'}
          className="w-full rounded-md border border-gray-300 px-2 py-1 text-xs"
        />
        <button
          type="button"
          onClick={submit}
          disabled={save.isPending || value.trim() === (product.woocommerceCategory ?? '')}
          className="rounded-md border border-gray-300 bg-white px-2 py-1 text-xs font-medium text-gray-700 hover:bg-gray-50 disabled:opacity-50"
        >
          Save
        </button>
      </div>
      {!product.woocommerceCategory && product.categoryPath && (
        <p className="mt-1 text-[11px] text-gray-500">If left empty, the file uses: {product.categoryPath}</p>
      )}
    </div>
  );
}

// ─── Check results ───────────────────────────────────────────────────────────

function CheckResults({ check, channel, onChanged }: { check: ChannelExportCheck; channel: ExportChannel; onChanged: () => void }) {
  const sorted = [...check.products].sort((a, b) => (a.status === b.status ? a.title.localeCompare(b.title) : a.status === 'needs-fixing' ? -1 : 1));
  return (
    <div className="space-y-3" aria-live="polite">
      <div className="flex flex-wrap gap-2 text-xs">
        <Badge variant="success">{check.readyCount} ready</Badge>
        {check.needsFixingCount > 0 && <Badge variant="error">{check.needsFixingCount} need fixing</Badge>}
        {check.missingProductIds.length > 0 && <Badge variant="neutral">{check.missingProductIds.length} not found</Badge>}
      </div>
      <ul className="divide-y divide-gray-100 rounded-md border border-gray-200">
        {sorted.map((p) => (
          <li key={p.productId} className="p-3">
            <div className="flex items-start justify-between gap-3">
              <div className="min-w-0">
                <p className="truncate text-sm font-medium text-gray-900">{p.title || '(no title)'}</p>
                <p className="text-xs text-gray-500">{p.sku}</p>
              </div>
              <Badge variant={p.status === 'ready' ? 'success' : 'error'}>{p.status === 'ready' ? 'Ready' : 'Needs fixing'}</Badge>
            </div>
            {p.findings.length > 0 && (
              <ul className="mt-2 space-y-1">
                {p.findings.map((f, i) => (
                  <li key={`${f.code}-${i}`} className="text-xs">
                    <span className={f.severity === 'ERROR' ? 'font-semibold text-red-700' : 'font-semibold text-amber-700'}>
                      {f.severity === 'ERROR' ? 'Fix' : 'Note'}:
                    </span>{' '}
                    <span className="text-gray-700">
                      {f.field}. {f.message}
                    </span>
                  </li>
                ))}
              </ul>
            )}
            {channel === 'shopify' && <ShopifyCategoryPicker product={p} onSaved={onChanged} />}
            {channel === 'woocommerce' && <WooCategoryField product={p} onSaved={onChanged} />}
            {p.status === 'needs-fixing' && (
              <a href={`/products/${p.productId}`} className="mt-2 inline-block text-xs font-medium text-primary-700 underline">
                Open the product to fix it
              </a>
            )}
          </li>
        ))}
      </ul>
    </div>
  );
}

// ─── History ─────────────────────────────────────────────────────────────────

function ExportHistory() {
  const history = useExportHistory();
  const link = useExportDownloadLink();
  const toast = useToast();

  const download = async (exportId: string) => {
    try {
      go((await link.mutateAsync(exportId)).downloadUrl);
    } catch {
      toast.toast({ variant: 'error', title: 'That file could not be downloaded', description: 'Files are kept for 90 days.' });
    }
  };

  return (
    <Card padding="lg">
      <h2 className="mb-3 text-sm font-semibold text-gray-900">Earlier exports</h2>
      {history.isLoading && <p className="text-sm text-gray-500">Loading…</p>}
      {history.data?.length === 0 && <p className="text-sm text-gray-500">No exports yet.</p>}
      {history.data && history.data.length > 0 && (
        <table className="w-full text-left text-sm">
          <caption className="sr-only">Earlier exports</caption>
          <thead className="text-xs text-gray-500">
            <tr>
              <th scope="col" className="py-1 pr-2 font-medium">Made</th>
              <th scope="col" className="py-1 pr-2 font-medium">Store</th>
              <th scope="col" className="py-1 pr-2 font-medium">Products</th>
              <th scope="col" className="py-1 pr-2 font-medium">Image links work until</th>
              <th scope="col" className="py-1 font-medium"><span className="sr-only">Download</span></th>
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-100">
            {history.data.map((e) => {
              const expired = new Date(e.imageLinksExpireAt).getTime() < Date.now();
              return (
                <tr key={e.exportId}>
                  <td className="py-2 pr-2">{formatDateTime(e.createdAt)}</td>
                  <td className="py-2 pr-2">{STORE_NAME[e.channel] ?? e.channel}</td>
                  <td className="py-2 pr-2">
                    {e.productCount}
                    {e.excludedCount > 0 ? ` (${e.excludedCount} left out)` : ''}
                  </td>
                  <td className={'py-2 pr-2 ' + (expired ? 'text-red-700' : '')}>
                    {formatDateTime(e.imageLinksExpireAt)}
                    {expired ? ' (expired, export again)' : ''}
                  </td>
                  <td className="py-2 text-right">
                    <button
                      type="button"
                      onClick={() => download(e.exportId)}
                      disabled={link.isPending}
                      className="text-sm font-medium text-primary-700 underline disabled:opacity-50"
                      aria-label={`Download ${e.filename}`}
                    >
                      Download
                    </button>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      )}
    </Card>
  );
}

// ─── Page ────────────────────────────────────────────────────────────────────

export default function ExportsPage() {
  const toast = useToast();
  const { data, isLoading } = useProducts({ page: 1, pageSize: MAX_PRODUCTS });
  const check = useCheckChannelExport();
  const create = useCreateChannelExport();

  const [channel, setChannel] = useState<ExportChannel>('shopify');
  const [selected, setSelected] = useState<string[]>([]);
  const [filter, setFilter] = useState('');
  const [result, setResult] = useState<ChannelExportCheck | null>(null);

  // Settings
  const [shopifyStatus, setShopifyStatus] = useState<'draft' | 'active'>('draft');
  const [wooStatus, setWooStatus] = useState<'draft' | 'published'>('draft');
  const [weightUnit, setWeightUnit] = useState<'kg' | 'g' | 'lbs' | 'oz'>('kg');
  const [dimensionUnit, setDimensionUnit] = useState<'cm' | 'm' | 'mm' | 'in' | 'yd'>('cm');
  const [useRrp, setUseRrp] = useState(false);
  const [takealotCategory, setTakealotCategory] = useState('');
  const [takealotFormat, setTakealotFormat] = useState<'CSV' | 'XLSX'>('XLSX');

  // Products ticked on the Products page.
  useEffect(() => {
    try {
      const raw = window.sessionStorage.getItem(EXPORT_SELECTION_KEY);
      if (raw) {
        const ids = JSON.parse(raw) as unknown;
        if (Array.isArray(ids)) setSelected(ids.filter((v): v is string => typeof v === 'string').slice(0, MAX_PRODUCTS));
        window.sessionStorage.removeItem(EXPORT_SELECTION_KEY);
      }
    } catch {
      // Ignore a damaged handoff.
    }
  }, []);

  const products = data?.items ?? [];
  const visible = useMemo(() => {
    const q = filter.trim().toLowerCase();
    return q ? products.filter((p) => `${p.title} ${p.sku} ${p.brand ?? ''}`.toLowerCase().includes(q)) : products;
  }, [products, filter]);

  const options: ChannelExportOptions = useMemo(
    () => ({
      shopify: { status: shopifyStatus, useRrpAsCompareAt: useRrp },
      woocommerce: { status: wooStatus, weightUnit, dimensionUnit, useRrpAsCompareAt: useRrp },
      takealot: { category: takealotCategory, format: takealotFormat },
    }),
    [shopifyStatus, wooStatus, weightUnit, dimensionUnit, useRrp, takealotCategory, takealotFormat]
  );

  // Any change makes an earlier check out of date.
  useEffect(() => setResult(null), [channel, selected, options]);

  const toggle = (id: string) =>
    setSelected((prev) => (prev.includes(id) ? prev.filter((x) => x !== id) : prev.length >= MAX_PRODUCTS ? prev : [...prev, id]));
  const allVisibleSelected = visible.length > 0 && visible.every((p) => selected.includes(p.productId));
  const toggleAllVisible = () =>
    setSelected((prev) => {
      if (allVisibleSelected) return prev.filter((id) => !visible.some((p) => p.productId === id));
      const add = visible.map((p) => p.productId).filter((id) => !prev.includes(id));
      return [...prev, ...add].slice(0, MAX_PRODUCTS);
    });

  const runCheck = async () => {
    try {
      setResult(await check.mutateAsync({ channel, productIds: selected, options }));
    } catch (e) {
      toast.toast({ variant: 'error', title: 'The check could not run', description: (e as { message?: string }).message });
    }
  };

  const makeFile = async (onlyReady: boolean) => {
    try {
      const res = await create.mutateAsync({ channel, productIds: selected, options, onlyReady });
      toast.toast({
        variant: 'success',
        title: 'Export ready',
        description: `${res.export.productCount} products. Image links in this file work for 7 days.`,
      });
      go(res.downloadUrl);
    } catch (e) {
      const err = e as { statusCode?: number; message?: string };
      if (err.statusCode === 409) {
        toast.toast({ variant: 'warning', title: 'Some products changed', description: 'Checking again.' });
        await runCheck();
      } else {
        toast.toast({ variant: 'error', title: 'The export could not be made', description: err.message });
      }
    }
  };

  const busy = check.isPending || create.isPending;
  const radio = 'h-4 w-4 border-gray-300 text-primary-600';
  const select = 'rounded-md border border-gray-300 px-2 py-1 text-sm';

  return (
    <div className="mx-auto max-w-4xl space-y-6">
      <div>
        <h1 className="text-xl font-semibold tracking-tight text-gray-900">Exports</h1>
        <p className="text-sm text-gray-500">
          Make an import file for your online store or marketplace. Products are checked against that store&apos;s rules first.
        </p>
      </div>

      {/* 1. Store */}
      <Card padding="lg">
        <fieldset>
          <legend className="mb-3 text-sm font-semibold text-gray-900">1. Where to?</legend>
          <div className="grid gap-2 sm:grid-cols-3">
            {STORES.map((s) => (
              <label
                key={s.id}
                className={
                  'flex cursor-pointer items-start gap-2 rounded-md border p-3 text-sm ' +
                  (s.soon ? 'cursor-not-allowed border-gray-200 bg-gray-50 text-gray-400' : channel === s.id ? 'border-primary-500 ring-1 ring-primary-500' : 'border-gray-300')
                }
              >
                <input
                  type="radio"
                  name="store"
                  className={radio + ' mt-0.5'}
                  value={s.id}
                  checked={channel === s.id}
                  disabled={s.soon}
                  onChange={() => !s.soon && setChannel(s.id as ExportChannel)}
                />
                <span>
                  <span className="block font-medium">{s.name}</span>
                  <span className="block text-xs">{s.note}</span>
                </span>
              </label>
            ))}
          </div>
        </fieldset>
      </Card>

      {/* 2. Products */}
      <Card padding="lg">
        <div className="mb-3 flex flex-wrap items-end justify-between gap-3">
          <h2 className="text-sm font-semibold text-gray-900">2. Which products?</h2>
          <span className="text-xs text-gray-500" aria-live="polite">
            {selected.length} of {MAX_PRODUCTS} max selected
          </span>
        </div>
        <label htmlFor="product-filter" className="sr-only">
          Search products
        </label>
        <input
          id="product-filter"
          type="search"
          value={filter}
          onChange={(e) => setFilter(e.target.value)}
          placeholder="Search by title, SKU or brand"
          className="mb-2 w-full rounded-md border border-gray-300 px-3 py-2 text-sm"
        />
        {isLoading ? (
          <p className="text-sm text-gray-500">Loading products…</p>
        ) : products.length === 0 ? (
          <p className="text-sm text-gray-500">No products yet.</p>
        ) : (
          <>
            <label className="mb-1 flex items-center gap-2 text-sm text-gray-700">
              <input type="checkbox" className="h-4 w-4 rounded border-gray-300" checked={allVisibleSelected} onChange={toggleAllVisible} />
              Select all {filter.trim() ? 'shown' : ''} ({visible.length})
            </label>
            <ul className="max-h-72 divide-y divide-gray-100 overflow-y-auto rounded-md border border-gray-200" aria-label="Products">
              {visible.map((p) => (
                <li key={p.productId}>
                  <label className="flex cursor-pointer items-center gap-3 px-3 py-2 text-sm hover:bg-gray-50">
                    <input type="checkbox" className="h-4 w-4 rounded border-gray-300" checked={selected.includes(p.productId)} onChange={() => toggle(p.productId)} />
                    <span className="min-w-0 flex-1 truncate">{p.title || '(no title)'}</span>
                    <span className="shrink-0 text-xs text-gray-500">{p.sku}</span>
                  </label>
                </li>
              ))}
            </ul>
          </>
        )}
      </Card>

      {/* 3. Settings */}
      <Card padding="lg">
        <h2 className="mb-3 text-sm font-semibold text-gray-900">3. Settings for {STORE_NAME[channel]}</h2>
        {channel === 'shopify' && (
          <div className="space-y-3 text-sm">
            <fieldset className="flex flex-wrap gap-4">
              <legend className="mb-1 w-full text-gray-700">Products arrive in Shopify as</legend>
              <label className="flex items-center gap-2"><input type="radio" className={radio} name="shopify-status" checked={shopifyStatus === 'draft'} onChange={() => setShopifyStatus('draft')} /> Draft (check them before they go live)</label>
              <label className="flex items-center gap-2"><input type="radio" className={radio} name="shopify-status" checked={shopifyStatus === 'active'} onChange={() => setShopifyStatus('active')} /> Active</label>
            </fieldset>
          </div>
        )}
        {channel === 'woocommerce' && (
          <div className="space-y-3 text-sm">
            <fieldset className="flex flex-wrap gap-4">
              <legend className="mb-1 w-full text-gray-700">Products arrive in WooCommerce as</legend>
              <label className="flex items-center gap-2"><input type="radio" className={radio} name="woo-status" checked={wooStatus === 'draft'} onChange={() => setWooStatus('draft')} /> Draft</label>
              <label className="flex items-center gap-2"><input type="radio" className={radio} name="woo-status" checked={wooStatus === 'published'} onChange={() => setWooStatus('published')} /> Published</label>
            </fieldset>
            <div className="flex flex-wrap items-center gap-4">
              <label className="flex items-center gap-2">
                Store weight unit
                <select className={select} value={weightUnit} onChange={(e) => setWeightUnit(e.target.value as typeof weightUnit)}>
                  <option value="kg">kg</option>
                  <option value="g">g</option>
                  <option value="lbs">lbs</option>
                  <option value="oz">oz</option>
                </select>
              </label>
              <label className="flex items-center gap-2">
                Store size unit
                <select className={select} value={dimensionUnit} onChange={(e) => setDimensionUnit(e.target.value as typeof dimensionUnit)}>
                  <option value="cm">cm</option>
                  <option value="mm">mm</option>
                  <option value="m">m</option>
                  <option value="in">in</option>
                  <option value="yd">yd</option>
                </select>
              </label>
            </div>
            <p className="text-xs text-gray-500">
              Use the units set in WooCommerce under Settings, Products. WooCommerce copies the numbers as they are.
            </p>
          </div>
        )}
        {channel === 'takealot' && (
          <div className="space-y-3 text-sm">
            <div>
              <label htmlFor="takealot-category" className="mb-1 block text-gray-700">Takealot category</label>
              <input
                id="takealot-category"
                type="text"
                value={takealotCategory}
                onChange={(e) => setTakealotCategory(e.target.value)}
                placeholder="e.g. Accessories->Eyewear (29451)"
                className="w-full rounded-md border border-gray-300 px-3 py-2 text-sm"
              />
              <p className="mt-1 text-xs text-gray-500">The lowest-level Takealot category with its number in brackets. One category per file.</p>
            </div>
            <label className="flex items-center gap-2">
              File type
              <select className={select} value={takealotFormat} onChange={(e) => setTakealotFormat(e.target.value as 'CSV' | 'XLSX')}>
                <option value="XLSX">Excel loadsheet (XLSX)</option>
                <option value="CSV">CSV</option>
              </select>
            </label>
          </div>
        )}
        {channel !== 'takealot' && (
          <label className="mt-3 flex items-center gap-2 text-sm">
            <input type="checkbox" className="h-4 w-4 rounded border-gray-300" checked={useRrp} onChange={(e) => setUseRrp(e.target.checked)} />
            Show the RRP as the was-price (struck through) when it is higher than your price
          </label>
        )}
      </Card>

      {/* 4. Check and download */}
      <Card padding="lg">
        <h2 className="mb-3 text-sm font-semibold text-gray-900">4. Check and download</h2>
        <div className="flex flex-wrap gap-3">
          <button
            type="button"
            onClick={runCheck}
            disabled={selected.length === 0 || busy}
            className="inline-flex items-center rounded-md bg-primary-600 px-4 py-2 text-sm font-medium text-white hover:bg-primary-700 disabled:cursor-not-allowed disabled:opacity-50"
          >
            {check.isPending ? 'Checking…' : `Check ${selected.length || ''} product${selected.length === 1 ? '' : 's'}`}
          </button>
          {result && result.readyCount > 0 && (
            <button
              type="button"
              onClick={() => makeFile(result.needsFixingCount > 0)}
              disabled={busy}
              className="inline-flex items-center rounded-md border border-gray-300 bg-white px-4 py-2 text-sm font-medium text-gray-700 hover:bg-gray-50 disabled:opacity-50"
            >
              {create.isPending
                ? 'Making the file…'
                : result.needsFixingCount > 0
                  ? `Download the ${result.readyCount} ready product${result.readyCount === 1 ? '' : 's'}`
                  : 'Download the file'}
            </button>
          )}
        </div>
        {selected.length === 0 && <p className="mt-2 text-xs text-gray-500">Choose at least one product.</p>}
        {result && (
          <div className="mt-4 space-y-3">
            {result.needsFixingCount > 0 && result.readyCount > 0 && (
              <Alert variant="warning" title="Some products need fixing">
                You can download the ready products now and export the others once they are fixed.
              </Alert>
            )}
            {result.readyCount === 0 && (
              <Alert variant="error" title="Nothing is ready yet">
                Fix the products below, then check again.
              </Alert>
            )}
            <p className="text-xs text-gray-500">
              Image links in the file work for 7 days. Import it within that time, or export again.
            </p>
            <CheckResults check={result} channel={channel} onChanged={runCheck} />
          </div>
        )}
      </Card>

      <ExportHistory />
    </div>
  );
}
