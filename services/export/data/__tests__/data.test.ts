import { describe, it, expect } from 'vitest';
import { generateKeyPairSync, createVerify } from 'node:crypto';
import type { CanonicalImageRef, CanonicalProduct } from '@merch-os/types';
import { imageRefsFor, toExportProduct } from '../prepare.js';
import { imageLinker, objectUrl } from '../image-links.js';
import { isExportId, newExportId } from '../archive.js';
import { DynamoProductStore } from '../product-store.js';

const ref = (s3Key: string, position: number, variantId: string | null): CanonicalImageRef => ({
  imageId: s3Key,
  s3Key,
  position,
  altText: null,
  mimeType: 'image/jpeg',
  width: 0,
  height: 0,
  fileSize: 0,
  variantId,
});

function product(refs: CanonicalImageRef[], variants: CanonicalProduct['content']['variants'] = []): CanonicalProduct {
  return {
    productId: 'p1',
    tenantId: 't1',
    content: { title: 'X', sku: 'X-1', attributes: { colour: 'Red' }, imageRefs: refs, variants } as unknown as CanonicalProduct['content'],
    commercial: {} as CanonicalProduct['commercial'],
    platformSpecific: { platformIdentifiers: {}, categoryMappings: {}, metadata: {}, exportHistory: {} },
    lifecycleState: 'ready',
    createdAt: '',
    updatedAt: '',
  };
}

describe('which images go in a store file', () => {
  // The image pipeline: main image (variantId null) + a resized copy per store.
  const refs = [
    ref('images/t1/p1/hero.jpg', 0, null),
    ref('images/t1/p1/takealot/1000x1000.jpg', 1, 'takealot'),
    ref('images/t1/p1/shopify/2048x2048.jpg', 2, 'shopify'),
    ref('images/t1/p1/amazon/2000x2000.jpg', 3, 'amazon'),
  ];
  it("uses the store's own copy, never another store's", () => {
    expect(imageRefsFor(product(refs), 'shopify').map((r) => r.s3Key)).toEqual(['images/t1/p1/shopify/2048x2048.jpg']);
    expect(imageRefsFor(product(refs), 'takealot').map((r) => r.s3Key)).toEqual(['images/t1/p1/takealot/1000x1000.jpg']);
  });
  it('falls back to the main image when the store has no copy', () => {
    expect(imageRefsFor(product(refs), 'woocommerce').map((r) => r.s3Key)).toEqual(['images/t1/p1/hero.jpg']);
  });
  it('keeps several imported images in order, and variant images tagged with their variant', () => {
    const p = product(
      [ref('https://sup.example/b.jpg', 1, null), ref('https://sup.example/a.jpg', 0, null), ref('images/t1/p1/red.jpg', 2, 'v-red')],
      [{ variantId: 'v-red', sku: 'X-R', barcode: null, optionValues: { Colour: 'Red' }, priceOverride: null, stockOverride: null, imageRefs: [] }]
    );
    expect(imageRefsFor(p, 'shopify').map((r) => [r.s3Key, r.variantId])).toEqual([
      ['https://sup.example/a.jpg', null],
      ['https://sup.example/b.jpg', null],
      ['images/t1/p1/red.jpg', 'v-red'],
    ]);
  });
  it('prepares keywords, category path and attributes (seller values win over suggestions)', () => {
    const ep = toExportProduct(
      product([]),
      { enrichment: { attributes: { keywords: { value: 'mug, ceramic; gift' }, categoryPath: { value: 'Kitchen > Mugs' }, colour: { value: 'Blue' } } } },
      { 'X-1': 3 },
      'shopify',
      (k) => `L:${k}`
    );
    expect(ep.keywords).toEqual(['mug', 'ceramic', 'gift']);
    expect(ep.categoryPath).toBe('Kitchen > Mugs');
    expect(ep.attributes['colour']).toBe('Red');
    expect(ep.stockBySku).toEqual({ 'X-1': 3 });
  });
});

describe('image links', () => {
  const { privateKey, publicKey } = generateKeyPairSync('rsa', { modulusLength: 2048 });
  const pem = privateKey.export({ type: 'pkcs8', format: 'pem' }).toString();
  const expiresAt = new Date('2026-12-05T10:00:00Z');
  const link = imageLinker({ domain: 'd111.cloudfront.net', keyPairId: 'K123', privateKey: pem, expiresAt });

  it('signs private images for 7 days with a valid CloudFront signature', () => {
    const url = new URL(link('images/t1/p1/hero image.jpg'));
    expect(url.origin + url.pathname).toBe('https://d111.cloudfront.net/images/t1/p1/hero%20image.jpg');
    expect(url.searchParams.get('Key-Pair-Id')).toBe('K123');
    expect(url.searchParams.get('Expires')).toBe(String(expiresAt.getTime() / 1000));
    // Canned policy: the signature covers the exact resource and expiry.
    const policy = JSON.stringify({
      Statement: [{ Resource: objectUrl('d111.cloudfront.net', 'images/t1/p1/hero image.jpg'), Condition: { DateLessThan: { 'AWS:EpochTime': expiresAt.getTime() / 1000 } } }],
    });
    const sig = url.searchParams.get('Signature')!.replace(/-/g, '+').replace(/_/g, '=').replace(/~/g, '/');
    expect(createVerify('RSA-SHA1').update(policy).verify(publicKey, sig, 'base64')).toBe(true);
  });
  it('keeps supplier web addresses as they are', () => {
    expect(link('https://sup.example/a.jpg')).toBe('https://sup.example/a.jpg');
  });
});

describe('export ids', () => {
  it('sort by time and refuse anything else (no path tricks)', () => {
    const id = newExportId(new Date('2026-11-28T10:15:00.123Z'), 'ab12cd34');
    expect(id).toBe('20261128T101500Z-ab12cd34');
    expect(isExportId(id)).toBe(true);
    expect(isExportId('../other-tenant')).toBe(false);
    expect(isExportId('20261128T101500Z-ab12cd34/../x')).toBe(false);
  });
});

describe('product store', () => {
  type Sent = { input: Record<string, unknown>; constructor: { name: string } };
  function fakeDoc(responses: Record<string, unknown>[]) {
    const sent: Sent[] = [];
    return {
      sent,
      doc: {
        send: async (cmd: Sent) => {
          sent.push(cmd);
          return responses.shift() ?? {};
        },
      },
    };
  }

  it("loads only the signed-in seller's products (keys and results both in their partition)", async () => {
    const { doc, sent } = fakeDoc([
      {
        Responses: {
          products: [
            { PK: 'TENANT#t1', SK: 'PRODUCT#p1', productId: 'p1', tenantId: 't1', content: {} },
            { PK: 'TENANT#t1', SK: 'PRODUCT#p1#ENRICHMENT', enrichment: { attributes: {} } },
            { PK: 'TENANT#t2', SK: 'PRODUCT#p2', productId: 'p2', tenantId: 't2', content: {} },
          ],
        },
      },
    ]);
    const store = new DynamoProductStore('products', 'inventory', doc as never);
    const out = await store.loadProducts('t1', ['p1', 'p2', 'p1']);
    expect([...out.keys()]).toEqual(['p1']);
    expect(out.get('p1')!.enrichment).not.toBeNull();
    const keys = (sent[0]!.input['RequestItems'] as Record<string, { Keys: Array<{ PK: string }> }>)['products']!.Keys;
    expect(keys).toHaveLength(4);
    expect(keys.every((k) => k.PK === 'TENANT#t1')).toBe(true);
  });

  it('retries keys DynamoDB did not process', async () => {
    const { doc, sent } = fakeDoc([
      { Responses: { products: [] }, UnprocessedKeys: { products: { Keys: [{ PK: 'TENANT#t1', SK: 'PRODUCT#p1' }] } } },
      { Responses: { products: [{ PK: 'TENANT#t1', SK: 'PRODUCT#p1', productId: 'p1', tenantId: 't1', content: {} }] } },
    ]);
    const out = await new DynamoProductStore('products', 'inventory', doc as never).loadProducts('t1', ['p1']);
    expect(sent).toHaveLength(2);
    expect(out.has('p1')).toBe(true);
  });

  it('sums available stock per SKU over warehouses and pages', async () => {
    const { doc, sent } = fakeDoc([
      { Items: [{ sku: 'A', available: 3 }, { sku: 'A', available: 2 }], LastEvaluatedKey: { PK: 'x' } },
      { Items: [{ sku: 'B', onHand: 5, reserved: 1 }] },
    ]);
    expect(await new DynamoProductStore('products', 'inventory', doc as never).loadStock('t1')).toEqual({ A: 5, B: 4 });
    expect(sent[0]!.input['ExpressionAttributeValues']).toEqual({ ':pk': 'TENANT#t1', ':sku': 'SKU#' });
  });

  it('remembers a store category and the Shopify handle on the product (only if it exists)', async () => {
    const { doc, sent } = fakeDoc([{}, {}]);
    const store = new DynamoProductStore('products', 'inventory', doc as never);
    await store.saveChannelCategory('t1', 'p1', 'shopify', 'hg-11-10-5-5');
    await store.recordExport('t1', 'p1', 'shopify', { date: '2026-11-28', version: 'v', shopifyHandle: 'mug' });
    expect(sent[0]!.input).toMatchObject({
      Key: { PK: 'TENANT#t1', SK: 'PRODUCT#p1' },
      UpdateExpression: 'SET platformSpecific.categoryMappings.#ch = :v',
      ConditionExpression: 'attribute_exists(PK)',
    });
    expect(String(sent[1]!.input['UpdateExpression'])).toContain('platformSpecific.platformIdentifiers.#shop = :handle');
  });
});
