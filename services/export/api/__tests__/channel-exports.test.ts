import { describe, it, expect, beforeEach } from 'vitest';
import type { APIGatewayProxyEventV2 } from 'aws-lambda';
import type { CanonicalProduct } from '@merch-os/types';
import { ChannelExportService, ExportNeedsFixingError, ExportRequestError, saDate } from '../channel-export-service.js';
import { handler, identity, setChannelExportDeps } from '../handlers/channel-exports.js';
import type { ProductStorePort, StoredProduct } from '../../data/product-store.js';
import type { ExportArchivePort, ExportManifest } from '../../data/archive.js';
import { parseCsv } from '../../engine/csv-parse.js';

function product(id: string, over: Partial<CanonicalProduct['content']> = {}, commercial: Partial<CanonicalProduct['commercial']> = {}): CanonicalProduct {
  return {
    productId: id,
    tenantId: 't1',
    content: {
      title: `Product ${id}`,
      shortDescription: null,
      longDescription: 'Nice.',
      bulletPoints: [],
      brand: 'Acme',
      manufacturer: null,
      sku: `SKU-${id}`,
      barcode: null,
      mpn: null,
      weight: 1,
      weightUnit: 'kg',
      length: null,
      width: null,
      height: null,
      dimensionUnit: null,
      materials: [],
      attributes: {},
      imageRefs: [
        { imageId: 'i', s3Key: `images/t1/${id}/hero.jpg`, position: 0, altText: null, mimeType: 'image/jpeg', width: 0, height: 0, fileSize: 0, variantId: null },
      ],
      variants: [],
      ...over,
    },
    commercial: {
      sellingPrice: 100,
      rrp: null,
      salePrice: null,
      currency: 'ZAR',
      stockQuantity: 1,
      lowStockThreshold: null,
      fulfilmentMethod: null,
      leadtimeDays: null,
      handlingTimeDays: null,
      listingStatus: 'active',
      saleStartDate: null,
      saleEndDate: null,
      ...commercial,
    },
    platformSpecific: { platformIdentifiers: {}, categoryMappings: {}, metadata: {}, exportHistory: {} },
    lifecycleState: 'ready',
    createdAt: '',
    updatedAt: '',
  };
}

class FakeStore implements ProductStorePort {
  products = new Map<string, StoredProduct>();
  recorded: Array<{ id: string; handle?: string }> = [];
  categories: Array<[string, string, string | null]> = [];
  async loadProducts(tenantId: string, ids: readonly string[]) {
    const out = new Map<string, StoredProduct>();
    for (const id of ids) {
      const p = this.products.get(id);
      if (p && p.product.tenantId === tenantId) out.set(id, p);
    }
    return out;
  }
  async loadStock() {
    return { 'SKU-a': 7 };
  }
  async saveChannelCategory(_t: string, id: string, ch: string, v: string | null) {
    this.categories.push([id, ch, v]);
  }
  async recordExport(_t: string, id: string, _ch: string, e: { shopifyHandle?: string }) {
    this.recorded.push({ id, ...(e.shopifyHandle ? { handle: e.shopifyHandle } : {}) });
  }
}

class FakeArchive implements ExportArchivePort {
  saved: Array<{ tenantId: string; manifest: ExportManifest; body: string | Buffer }> = [];
  async save(tenantId: string, manifest: ExportManifest, body: string | Buffer) {
    this.saved.push({ tenantId, manifest, body });
  }
  async list(tenantId: string) {
    return this.saved.filter((s) => s.tenantId === tenantId).map((s) => s.manifest);
  }
  async get(tenantId: string, id: string) {
    return this.saved.find((s) => s.tenantId === tenantId && s.manifest.exportId === id)?.manifest ?? null;
  }
  async downloadUrl(_t: string, m: ExportManifest) {
    return `https://download/${m.filename}`;
  }
}

const NOW = new Date('2026-11-28T08:00:00Z');
let store: FakeStore;
let archive: FakeArchive;
let svc: ChannelExportService;

beforeEach(() => {
  store = new FakeStore();
  archive = new FakeArchive();
  svc = new ChannelExportService({
    store,
    archive,
    imageLinker: async (exp) => (k) => `https://cdn/${k}?exp=${exp.toISOString()}`,
    now: () => NOW,
    random: () => 'abc123',
  });
  store.products.set('a', { product: product('a'), enrichment: { enrichment: { attributes: { keywords: { value: 'one, two' }, categoryPath: { value: 'Home > Mugs' } } } } });
  store.products.set('b', { product: product('b', {}, { sellingPrice: null }), enrichment: null });
});

describe('store export service', () => {
  it('checks each product: Ready or Needs fixing, and reports ids that are not this seller\'s', async () => {
    const r = await svc.check('t1', { channel: 'shopify', productIds: ['a', 'b', 'zzz'] });
    expect(r.products.map((p) => [p.productId, p.status])).toEqual([['a', 'ready'], ['b', 'needs-fixing']]);
    expect(r.missingProductIds).toEqual(['zzz']);
    expect(r.templateVersion).toBe('shopify-product-csv@2026-11');
    expect(r.products[0]!.categoryPath).toBe('Home > Mugs');
  });

  it('never exports another seller\'s product', async () => {
    store.products.set('x', { product: { ...product('x'), tenantId: 't2' }, enrichment: null });
    const r = await svc.check('t1', { channel: 'woocommerce', productIds: ['x'] });
    expect(r.products).toEqual([]);
    expect(r.missingProductIds).toEqual(['x']);
  });

  it('refuses a file that would silently leave products out', async () => {
    await expect(svc.create('t1', 'u1', { channel: 'shopify', productIds: ['a', 'b'] })).rejects.toBeInstanceOf(ExportNeedsFixingError);
    expect(archive.saved).toHaveLength(0);
  });

  it('exports only the Ready ones when asked, stores the file and remembers the Shopify handle', async () => {
    const res = await svc.create('t1', 'u1', { channel: 'shopify', productIds: ['a', 'b'], onlyReady: true });
    expect(res.manifest).toMatchObject({
      exportId: '20261128T080000Z-abc123',
      channel: 'shopify',
      productCount: 1,
      excludedCount: 1,
      createdBy: 'u1',
      imageLinksExpireAt: '2026-12-05T08:00:00.000Z',
      filename: 'shopify-products-20261128-0800-1.csv',
    });
    const rows = parseCsv(archive.saved[0]!.body as string);
    expect(rows).toHaveLength(2);
    const col = (c: string) => rows[1]![rows[0]!.indexOf(c)];
    expect(col('URL handle')).toBe('product-a');
    expect(col('Inventory quantity')).toBe('7'); // Inventory, not the product figure (1)
    expect(col('Tags')).toBe('one, two');
    expect(col('Type')).toBe('Mugs');
    expect(col('Status')).toBe('draft');
    expect(col('Product image URL')).toBe('https://cdn/images/t1/a/hero.jpg?exp=2026-12-05T08:00:00.000Z');
    expect(store.recorded).toEqual([{ id: 'a', handle: 'product-a' }]);
    expect(res.downloadUrl).toBe('https://download/shopify-products-20261128-0800-1.csv');
  });

  it('flags the same SKU used by two products in one file', async () => {
    store.products.set('c', { product: product('c', { sku: 'SKU-a' }), enrichment: null });
    const r = await svc.check('t1', { channel: 'woocommerce', productIds: ['a', 'c'] });
    for (const p of r.products) expect(p.findings.map((f) => f.code)).toContain('SKU_IN_ANOTHER_PRODUCT');
  });

  it('uses the WooCommerce store units chosen by the seller', async () => {
    const res = await svc.create('t1', null, {
      channel: 'woocommerce',
      productIds: ['a'],
      options: { woocommerce: { weightUnit: 'g', dimensionUnit: 'mm', status: 'published' } },
    });
    const rows = parseCsv(archive.saved[0]!.body as string);
    expect(rows[0]).toContain('Weight (g)');
    expect(rows[1]![rows[0]!.indexOf('Weight (g)')]).toBe('1000');
    expect(rows[1]![rows[0]!.indexOf('Published')]).toBe('1');
    expect(res.manifest.templateVersion).toBe('woocommerce-product-csv@3.1');
  });

  it('Takealot without a category says what to choose', async () => {
    const r = await svc.check('t1', { channel: 'takealot', productIds: ['a'] });
    expect(r.products[0]!.status).toBe('needs-fixing');
    expect(r.products[0]!.findings[0]!.code).toBe('TAKEALOT_CATEGORY');
  });

  it('limits a request to 500 products and known stores', async () => {
    await expect(svc.check('t1', { channel: 'shopify', productIds: Array.from({ length: 501 }, (_, i) => `p${i}`) })).rejects.toBeInstanceOf(ExportRequestError);
    await expect(svc.check('t1', { channel: 'amazon' as never, productIds: ['a'] })).rejects.toBeInstanceOf(ExportRequestError);
    await expect(svc.check('t1', { channel: 'shopify', productIds: ['../x'] })).rejects.toBeInstanceOf(ExportRequestError);
  });

  it('dates sales in South African time', () => {
    expect(saDate(new Date('2026-11-28T22:30:00Z'))).toBe('2026-11-29');
  });
});

function event(routeKey: string, opts: { body?: unknown; path?: Record<string, string>; query?: Record<string, string>; tenant?: string | null } = {}): APIGatewayProxyEventV2 {
  const claims: Record<string, string> = { sub: 'u1' };
  if (opts.tenant !== null) claims['custom:tenantId'] = opts.tenant ?? 't1';
  return {
    routeKey,
    ...(opts.body !== undefined ? { body: JSON.stringify(opts.body) } : {}),
    pathParameters: opts.path,
    queryStringParameters: opts.query,
    requestContext: { authorizer: { jwt: { claims } } },
  } as unknown as APIGatewayProxyEventV2;
}

describe('store export API', () => {
  beforeEach(() => setChannelExportDeps({ service: svc, archive: archive as never, store: store as never }));

  it('needs a signed-in seller and ignores any tenant in the body', async () => {
    expect((await handler(event('GET /exports', { tenant: null }))) as { statusCode: number }).toMatchObject({ statusCode: 401 });
    expect(identity(event('GET /exports', { body: { tenantId: 't2' } }))).toEqual({ tenantId: 't1', userId: 'u1' });
  });

  it('returns 409 with the check when products need fixing', async () => {
    const res = (await handler(event('POST /exports', { body: { channel: 'shopify', productIds: ['b'] } }))) as { statusCode: number; body: string };
    expect(res.statusCode).toBe(409);
    expect(JSON.parse(res.body).error.check.needsFixingCount).toBe(1);
  });

  it('creates, lists and re-downloads only the seller\'s own exports', async () => {
    const created = (await handler(event('POST /exports', { body: { channel: 'woocommerce', productIds: ['a'] } }))) as { statusCode: number; body: string };
    expect(created.statusCode).toBe(201);
    const id = JSON.parse(created.body).export.exportId;
    const list = (await handler(event('GET /exports'))) as { body: string };
    expect(JSON.parse(list.body).exports).toHaveLength(1);
    const dl = (await handler(event('GET /exports/{exportId}/download', { path: { exportId: id } }))) as { statusCode: number };
    expect(dl.statusCode).toBe(200);
    const other = (await handler(event('GET /exports/{exportId}/download', { path: { exportId: id }, tenant: 't2' }))) as { statusCode: number };
    expect(other.statusCode).toBe(404);
  });

  it('only accepts real Shopify categories', async () => {
    const bad = (await handler(event('PUT /exports/products/{productId}/category', { path: { productId: 'a' }, body: { channel: 'shopify', value: 'made-up' } }))) as { statusCode: number };
    expect(bad.statusCode).toBe(400);
    const ok = (await handler(event('PUT /exports/products/{productId}/category', { path: { productId: 'a' }, body: { channel: 'shopify', value: 'hg-11-10-5-5' } }))) as { statusCode: number; body: string };
    expect(ok.statusCode).toBe(200);
    expect(JSON.parse(ok.body).path).toContain('Mugs');
    expect(store.categories).toEqual([['a', 'shopify', 'hg-11-10-5-5']]);
  });

  it('searches Shopify categories', async () => {
    const res = (await handler(event('GET /exports/shopify-categories', { query: { q: 'mugs' } }))) as { body: string };
    const b = JSON.parse(res.body);
    expect(b.version).toBe('v2026-11');
    expect(b.categories[0].id).toBe('hg-11-10-5-5');
  });
});
