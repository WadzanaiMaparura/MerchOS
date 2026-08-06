/**
 * Unit tests for HTML Extractor — verifies all three extraction strategies.
 * Requirements: 4.4, 4.5
 */
import { describe, it, expect } from 'vitest';
import {
  extractFromJsonLd,
  extractFromOpenGraph,
  extractFromCssSelectors,
  extractProductsFromHtml,
  resolveUrl,
} from '../../processors/html-extractor';
import * as cheerio from 'cheerio';

describe('HTML Extractor', () => {
  describe('extractFromJsonLd', () => {
    it('extracts product data from a valid JSON-LD script tag', () => {
      const html = `
        <html><head>
        <script type="application/ld+json">
        {
          "@context": "https://schema.org",
          "@type": "Product",
          "name": "Wireless Headphones",
          "description": "Premium noise-cancelling headphones",
          "sku": "WH-1000XM5",
          "brand": { "@type": "Brand", "name": "SoundTech" },
          "category": "Electronics",
          "image": ["https://example.com/img1.jpg", "https://example.com/img2.jpg"],
          "offers": {
            "@type": "Offer",
            "price": "299.99",
            "availability": "https://schema.org/InStock"
          }
        }
        </script>
        </head><body></body></html>
      `;
      const $ = cheerio.load(html);
      const products = extractFromJsonLd($, 'https://example.com/product/1');

      expect(products).toHaveLength(1);
      const p = products[0]!;
      expect(p.title).toBe('Wireless Headphones');
      expect(p.description).toBe('Premium noise-cancelling headphones');
      expect(p.sku).toBe('WH-1000XM5');
      expect(p.brand).toBe('SoundTech');
      expect(p.category).toBe('Electronics');
      expect(p.price).toBe('299.99');
      expect(p.stockAvailability).toBe('In Stock');
      expect(p.images).toEqual([
        'https://example.com/img1.jpg',
        'https://example.com/img2.jpg',
      ]);
    });

    it('extracts products from @graph array', () => {
      const html = `
        <html><head>
        <script type="application/ld+json">
        {
          "@context": "https://schema.org",
          "@graph": [
            { "@type": "WebPage", "name": "Store" },
            { "@type": "Product", "name": "Widget A", "sku": "W-001" },
            { "@type": "Product", "name": "Widget B", "sku": "W-002" }
          ]
        }
        </script>
        </head><body></body></html>
      `;
      const $ = cheerio.load(html);
      const products = extractFromJsonLd($, 'https://example.com');

      expect(products).toHaveLength(2);
      expect(products[0]!.title).toBe('Widget A');
      expect(products[1]!.title).toBe('Widget B');
    });

    it('extracts variations from hasVariant', () => {
      const html = `
        <html><head>
        <script type="application/ld+json">
        {
          "@type": "Product",
          "name": "T-Shirt",
          "sku": "TS-001",
          "hasVariant": [
            { "@type": "Product", "name": "Small", "sku": "TS-001-S" },
            { "@type": "Product", "name": "Large", "sku": "TS-001-L" }
          ]
        }
        </script>
        </head><body></body></html>
      `;
      const $ = cheerio.load(html);
      const products = extractFromJsonLd($, 'https://example.com');

      expect(products).toHaveLength(1);
      expect(products[0]!.variations).toHaveLength(2);
      expect(products[0]!.variations![0]!.value).toBe('Small');
      expect(products[0]!.variations![1]!.sku).toBe('TS-001-L');
    });

    it('handles malformed JSON-LD gracefully', () => {
      const html = `
        <html><head>
        <script type="application/ld+json">
        { invalid json here
        </script>
        </head><body></body></html>
      `;
      const $ = cheerio.load(html);
      const products = extractFromJsonLd($, 'https://example.com');
      expect(products).toHaveLength(0);
    });
  });

  describe('extractFromOpenGraph', () => {
    it('extracts product data from OG meta tags', () => {
      const html = `
        <html><head>
        <meta property="og:title" content="Blue Running Shoes" />
        <meta property="og:description" content="Lightweight running shoes" />
        <meta property="og:image" content="https://example.com/shoes.jpg" />
        <meta property="product:price:amount" content="89.99" />
        <meta property="product:brand" content="RunFast" />
        <meta property="product:category" content="Footwear" />
        <meta property="product:retailer_item_id" content="RS-5000" />
        <meta property="product:availability" content="in stock" />
        </head><body></body></html>
      `;
      const $ = cheerio.load(html);
      const product = extractFromOpenGraph($, 'https://example.com/shoes');

      expect(product).not.toBeNull();
      expect(product!.title).toBe('Blue Running Shoes');
      expect(product!.description).toBe('Lightweight running shoes');
      expect(product!.price).toBe('89.99');
      expect(product!.brand).toBe('RunFast');
      expect(product!.category).toBe('Footwear');
      expect(product!.sku).toBe('RS-5000');
      expect(product!.stockAvailability).toBe('In Stock');
      expect(product!.images).toContain('https://example.com/shoes.jpg');
    });

    it('returns null when no og:title is present', () => {
      const html = `
        <html><head>
        <meta property="og:description" content="Some product" />
        </head><body></body></html>
      `;
      const $ = cheerio.load(html);
      const product = extractFromOpenGraph($, 'https://example.com');
      expect(product).toBeNull();
    });
  });

  describe('extractFromCssSelectors', () => {
    it('extracts product data using CSS selectors', () => {
      const html = `
        <html><body>
        <h1 class="product-title">Premium Coffee Mug</h1>
        <span class="price">$24.99</span>
        <div class="product-description">A beautifully crafted ceramic mug</div>
        <span class="sku">MUG-001</span>
        <span class="brand">CeramicWorks</span>
        <span class="availability">In Stock</span>
        <div class="product-image">
          <img src="/images/mug-1.jpg" />
          <img src="/images/mug-2.jpg" />
        </div>
        </body></html>
      `;
      const $ = cheerio.load(html);
      const products = extractFromCssSelectors($, 'https://shop.example.com/mug');

      expect(products).toHaveLength(1);
      const p = products[0]!;
      expect(p.title).toBe('Premium Coffee Mug');
      expect(p.price).toBe('$24.99');
      expect(p.description).toBe('A beautifully crafted ceramic mug');
      expect(p.sku).toBe('MUG-001');
      expect(p.brand).toBe('CeramicWorks');
      expect(p.stockAvailability).toBe('In Stock');
      expect(p.images).toEqual([
        'https://shop.example.com/images/mug-1.jpg',
        'https://shop.example.com/images/mug-2.jpg',
      ]);
    });

    it('extracts specs from product table', () => {
      const html = `
        <html><body>
        <h1>Laptop Pro</h1>
        <table class="product-specs">
          <tr><th>Processor</th><td>M3 Max</td></tr>
          <tr><th>RAM</th><td>36GB</td></tr>
          <tr><th>Storage</th><td>1TB SSD</td></tr>
        </table>
        </body></html>
      `;
      const $ = cheerio.load(html);
      const products = extractFromCssSelectors($, 'https://example.com');

      expect(products).toHaveLength(1);
      expect(products[0]!.specifications).toEqual({
        Processor: 'M3 Max',
        RAM: '36GB',
        Storage: '1TB SSD',
      });
    });

    it('returns empty array when no title is found', () => {
      const html = `<html><body><p>No product here</p></body></html>`;
      const $ = cheerio.load(html);
      const products = extractFromCssSelectors($, 'https://example.com');
      expect(products).toHaveLength(0);
    });
  });

  describe('extractProductsFromHtml', () => {
    it('prioritises JSON-LD over OpenGraph and CSS selectors', async () => {
      const html = `
        <html><head>
        <script type="application/ld+json">
        { "@type": "Product", "name": "From JSON-LD", "sku": "JLD-001" }
        </script>
        <meta property="og:title" content="From OpenGraph" />
        </head><body>
        <h1>From CSS</h1>
        </body></html>
      `;
      const config = {
        tenantId: 'tenant-1',
        supplierId: 'supplier-1',
        importJobId: 'job-1',
        assetsBucket: 'assets-bucket',
        downloadImages: false,
      };
      const result = await extractProductsFromHtml(html, 'https://example.com', config);

      expect(result.strategy).toBe('json-ld');
      expect(result.products[0]!.title).toBe('From JSON-LD');
    });

    it('falls back to OpenGraph when no JSON-LD is present', async () => {
      const html = `
        <html><head>
        <meta property="og:title" content="From OpenGraph" />
        <meta property="og:image" content="https://example.com/og.jpg" />
        </head><body>
        <h1>From CSS</h1>
        </body></html>
      `;
      const config = {
        tenantId: 'tenant-1',
        supplierId: 'supplier-1',
        importJobId: 'job-1',
        assetsBucket: 'assets-bucket',
        downloadImages: false,
      };
      const result = await extractProductsFromHtml(html, 'https://example.com', config);

      expect(result.strategy).toBe('opengraph');
      expect(result.products[0]!.title).toBe('From OpenGraph');
    });

    it('falls back to CSS selectors as last resort', async () => {
      const html = `
        <html><body>
        <h1 class="product-title">CSS Product</h1>
        <span class="price">$9.99</span>
        </body></html>
      `;
      const config = {
        tenantId: 'tenant-1',
        supplierId: 'supplier-1',
        importJobId: 'job-1',
        assetsBucket: 'assets-bucket',
        downloadImages: false,
      };
      const result = await extractProductsFromHtml(html, 'https://example.com', config);

      expect(result.strategy).toBe('css-selectors');
      expect(result.products[0]!.title).toBe('CSS Product');
    });

    it('returns none strategy when no product data is found', async () => {
      const html = `<html><body><p>Just a blog post</p></body></html>`;
      const config = {
        tenantId: 'tenant-1',
        supplierId: 'supplier-1',
        importJobId: 'job-1',
        assetsBucket: 'assets-bucket',
        downloadImages: false,
      };
      const result = await extractProductsFromHtml(html, 'https://example.com', config);

      expect(result.strategy).toBe('none');
      expect(result.products).toHaveLength(0);
      expect(result.productCount).toBe(0);
    });
  });

  describe('resolveUrl', () => {
    it('returns absolute URLs unchanged', () => {
      expect(resolveUrl('https://cdn.example.com/img.jpg', 'https://example.com'))
        .toBe('https://cdn.example.com/img.jpg');
    });

    it('resolves protocol-relative URLs', () => {
      expect(resolveUrl('//cdn.example.com/img.jpg', 'https://example.com'))
        .toBe('https://cdn.example.com/img.jpg');
    });

    it('resolves relative URLs', () => {
      expect(resolveUrl('/images/product.jpg', 'https://example.com/products/1'))
        .toBe('https://example.com/images/product.jpg');
    });

    it('resolves relative paths', () => {
      expect(resolveUrl('img.jpg', 'https://example.com/products/1'))
        .toBe('https://example.com/products/img.jpg');
    });

    it('returns empty string for empty input', () => {
      expect(resolveUrl('', 'https://example.com')).toBe('');
    });
  });
});
