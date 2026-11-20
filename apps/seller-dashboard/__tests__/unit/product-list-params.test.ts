import { describe, it, expect } from 'vitest';
import { applyListParams } from '@merch-os/api-client';
import type { ProductSummary } from '@merch-os/types';

const p = (over: Partial<ProductSummary> & { brand?: string }): ProductSummary => ({
  productId: over.sku ?? 'x',
  tenantId: 't',
  sku: 'SKU',
  title: 'Title',
  thumbnailUrl: null,
  lifecycleState: 'DRAFT',
  updatedAt: '2026-01-01T00:00:00.000Z',
  ...over,
});

const items = [
  p({ sku: 'KET-1', title: 'Steel Kettle', brand: 'Acme', updatedAt: '2026-01-03T00:00:00.000Z' }),
  p({ sku: 'TOA-1', title: 'Toaster', lifecycleState: 'REVIEW', updatedAt: '2026-01-05T00:00:00.000Z' }),
  p({ sku: 'BLE-10', title: 'Blender', updatedAt: '2026-01-01T00:00:00.000Z' }),
  p({ sku: 'BLE-2', title: 'blender mini', updatedAt: '2026-01-02T00:00:00.000Z' }),
];

describe('applyListParams (the API has no server-side search/sort/total)', () => {
  it('defaults to most recently updated first, with a real total', () => {
    const r = applyListParams(items, { page: 1, pageSize: 10 });
    expect(r.items.map((i) => i.sku)).toEqual(['TOA-1', 'KET-1', 'BLE-2', 'BLE-10']);
    expect(r).toMatchObject({ total: 4, page: 1, pageSize: 10, hasMore: false });
  });

  it('searches SKU, title and brand case-insensitively', () => {
    expect(applyListParams(items, { search: 'BLEND' }).items.map((i) => i.sku).sort()).toEqual(['BLE-10', 'BLE-2']);
    expect(applyListParams(items, { search: 'acme' }).items.map((i) => i.sku)).toEqual(['KET-1']);
    expect(applyListParams(items, { search: 'toa-1' }).total).toBe(1);
  });

  it('filters by lifecycle state', () => {
    expect(applyListParams(items, { lifecycleState: 'REVIEW' }).items.map((i) => i.sku)).toEqual(['TOA-1']);
  });

  it('sorts naturally, ascending unless desc', () => {
    expect(applyListParams(items, { sortBy: 'title' }).items.map((i) => i.title)).toEqual([
      'Blender', 'blender mini', 'Steel Kettle', 'Toaster',
    ]);
    expect(applyListParams(items, { sortBy: 'title', sortOrder: 'desc' }).items[0]!.title).toBe('Toaster');
  });

  it('pages after filtering and reports hasMore', () => {
    const r = applyListParams(items, { page: 2, pageSize: 3 });
    expect(r.items).toHaveLength(1);
    expect(r).toMatchObject({ total: 4, hasMore: false });
    expect(applyListParams(items, { page: 1, pageSize: 3 }).hasMore).toBe(true);
  });
});
