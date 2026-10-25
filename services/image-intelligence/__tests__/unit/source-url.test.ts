/**
 * Unit tests for supplier-URL image sourcing (G03).
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { S3Client } from '@aws-sdk/client-s3';
import {
  isSameOrigin,
  discoverSupplierImages,
  sourceSupplierImages,
  setS3Client,
} from '../../processors/source-url';

describe('isSameOrigin', () => {
  it('accepts an image on the same origin as the page', () => {
    expect(isSameOrigin('https://acme.com/img/1.jpg', 'https://acme.com/product/42')).toBe(true);
  });

  it('rejects a third-party / CDN image (different origin)', () => {
    expect(isSameOrigin('https://cdn.other.com/1.jpg', 'https://acme.com/product/42')).toBe(false);
  });

  it('rejects a different scheme or subdomain (strict origin match)', () => {
    expect(isSameOrigin('http://acme.com/1.jpg', 'https://acme.com/p')).toBe(false);
    expect(isSameOrigin('https://img.acme.com/1.jpg', 'https://acme.com/p')).toBe(false);
  });

  it('rejects malformed URLs safely', () => {
    expect(isSameOrigin('not-a-url', 'https://acme.com/p')).toBe(false);
  });
});

describe('discoverSupplierImages', () => {
  const pageUrl = 'https://acme.com/product/widget';

  it('returns only same-origin images and de-duplicates', async () => {
    // og:image (same origin) + an <img> on a CDN (third-party, must be excluded)
    const html = `
      <html><head>
        <meta property="og:image" content="https://acme.com/img/hero.jpg" />
        <meta property="og:title" content="Widget" />
      </head><body>
        <div class="product-image"><img src="https://acme.com/img/hero.jpg" /></div>
        <div class="product-gallery"><img src="https://cdn.thirdparty.com/x.jpg" /></div>
      </body></html>`;
    const imgs = await discoverSupplierImages(html, pageUrl);
    expect(imgs).toContain('https://acme.com/img/hero.jpg');
    expect(imgs.some((u) => u.includes('thirdparty.com'))).toBe(false);
    // de-duplicated (og:image + img point to the same hero)
    expect(imgs.filter((u) => u === 'https://acme.com/img/hero.jpg')).toHaveLength(1);
  });

  it('returns an empty list when the page has no product images', async () => {
    const imgs = await discoverSupplierImages('<html><body>nothing</body></html>', pageUrl);
    expect(imgs).toEqual([]);
  });
});

describe('sourceSupplierImages', () => {
  beforeEach(() => {
    setS3Client({ send: vi.fn().mockResolvedValue({}) } as unknown as S3Client);
  });
  afterEach(() => vi.restoreAllMocks());

  function makeFetch(pageHtml: string): typeof fetch {
    return vi.fn(async (input: unknown) => {
      const url = String(input);
      if (url.endsWith('/product/widget')) {
        return {
          ok: true,
          status: 200,
          text: async () => pageHtml,
          headers: new Map(),
        } as unknown as Response;
      }
      // image download
      return {
        ok: true,
        status: 200,
        arrayBuffer: async () => new Uint8Array([1, 2, 3]).buffer,
        headers: { get: () => 'image/jpeg' },
      } as unknown as Response;
    }) as unknown as typeof fetch;
  }

  it('downloads same-origin images to tenant/product raw-uploads source keys', async () => {
    const html = `<html><head><meta property="og:image" content="https://acme.com/img/hero.jpg"/><meta property="og:title" content="W"/></head><body><div class="product-image"><img src="https://acme.com/img/hero.jpg"/></div></body></html>`;
    const result = await sourceSupplierImages({
      pageUrl: 'https://acme.com/product/widget',
      tenantId: 't1',
      productId: 'p1',
      rawUploadsBucket: 'raw',
      fetchFn: makeFetch(html),
    });
    expect(result.imagesFound).toBe(1);
    expect(result.sourceKeys).toHaveLength(1);
    expect(result.sourceKeys[0]).toMatch(/^images\/t1\/p1\/source\/.+\.jpg$/);
  });

  it('returns zero keys (no-image case) when only third-party images exist', async () => {
    const html = `<html><head><meta property="og:title" content="W"/></head><body><div class="product-image"><img src="https://cdn.other.com/x.jpg"/></div></body></html>`;
    const result = await sourceSupplierImages({
      pageUrl: 'https://acme.com/product/widget',
      tenantId: 't1',
      productId: 'p1',
      rawUploadsBucket: 'raw',
      fetchFn: makeFetch(html),
    });
    expect(result.imagesFound).toBe(0);
    expect(result.sourceKeys).toEqual([]);
  });
});
