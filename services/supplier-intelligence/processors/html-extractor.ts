/**
 * HTML Extractor — Extract product data from HTML pages using multiple strategies.
 * Requirements: 4.4, 4.5
 *
 * Extraction strategies (in priority order):
 * 1. JSON-LD structured data (schema.org/Product)
 * 2. OpenGraph meta tags
 * 3. Common CSS selectors for product pages
 *
 * Responsibilities:
 * - Parse HTML and extract product data (name, description, SKU, brand, category, price,
 *   stock, images, variations, specs)
 * - Download product images and store in assets S3 bucket
 * - Return ParsedRecord-compatible objects for the validation pipeline
 */

import * as cheerio from 'cheerio';
import { S3Client, PutObjectCommand } from '@aws-sdk/client-s3';
import { randomUUID } from 'node:crypto';
import type { ParsedRecord } from './file-parser';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/** Extended product data extracted from HTML, beyond the base ParsedRecord fields. */
export interface HtmlExtractedProduct extends ParsedRecord {
  /** Stock availability text (e.g. "In Stock", "Out of Stock") */
  stockAvailability?: string;
  /** Product variations (e.g. sizes, colours) */
  variations?: ProductVariation[];
  /** Product specifications as key-value pairs */
  specifications?: Record<string, string>;
  /** Source URL the product was extracted from */
  sourceUrl: string;
}

/** A product variation (e.g. size/colour combination). */
export interface ProductVariation {
  name: string;
  value: string;
  price?: string;
  sku?: string;
  available?: boolean;
}

/** Configuration for the HTML extraction process. */
export interface HtmlExtractorConfig {
  /** Tenant identifier for S3 key construction */
  tenantId: string;
  /** Supplier identifier for S3 key construction */
  supplierId: string;
  /** Import job identifier for S3 key construction */
  importJobId: string;
  /** S3 bucket for storing downloaded images */
  assetsBucket: string;
  /** Whether to download and store images in S3 (default: true) */
  downloadImages?: boolean;
}

/** Result of extracting products from a single HTML page. */
export interface HtmlExtractionResult {
  products: HtmlExtractedProduct[];
  /** Number of products found on the page */
  productCount: number;
  /** Which extraction strategy produced results */
  strategy: ExtractionStrategy;
}

/** The extraction strategy that was used. */
export type ExtractionStrategy = 'json-ld' | 'opengraph' | 'css-selectors' | 'none';

// ---------------------------------------------------------------------------
// S3 Client (lazy-initialised for Lambda reuse)
// ---------------------------------------------------------------------------

let s3Client: S3Client | undefined;

function getS3Client(): S3Client {
  if (!s3Client) {
    s3Client = new S3Client({});
  }
  return s3Client;
}

/** Allow test code to inject a mock S3 client. */
export function setS3Client(client: S3Client): void {
  s3Client = client;
}

/** Reset S3 client (for test teardown). */
export function resetS3Client(): void {
  s3Client = undefined;
}

// ---------------------------------------------------------------------------
// Image Download Helper
// ---------------------------------------------------------------------------

/**
 * Download an image from a URL and store it in the assets S3 bucket.
 *
 * @param imageUrl - Absolute URL of the image to download
 * @param config - Extraction config with S3 destination details
 * @returns The S3 key where the image was stored, or null if download failed
 */
export async function downloadAndStoreImage(
  imageUrl: string,
  config: HtmlExtractorConfig
): Promise<string | null> {
  try {
    const response = await fetch(imageUrl, {
      method: 'GET',
      headers: { 'User-Agent': 'MerchOS-Crawler/1.0' },
      redirect: 'follow',
    });

    if (!response.ok) {
      return null;
    }

    const contentType = response.headers.get('content-type') ?? 'image/jpeg';
    const buffer = Buffer.from(await response.arrayBuffer());

    // Generate a unique S3 key for the image
    const extension = getImageExtension(contentType, imageUrl);
    const imageId = randomUUID();
    const s3Key = `assets/${config.tenantId}/${config.supplierId}/${config.importJobId}/${imageId}.${extension}`;

    const client = getS3Client();
    await client.send(
      new PutObjectCommand({
        Bucket: config.assetsBucket,
        Key: s3Key,
        Body: buffer,
        ContentType: contentType,
      })
    );

    return s3Key;
  } catch {
    return null;
  }
}

/**
 * Determine the file extension for a downloaded image based on content type and URL.
 */
function getImageExtension(contentType: string, url: string): string {
  const mimeToExt: Record<string, string> = {
    'image/jpeg': 'jpg',
    'image/jpg': 'jpg',
    'image/png': 'png',
    'image/gif': 'gif',
    'image/webp': 'webp',
    'image/svg+xml': 'svg',
    'image/avif': 'avif',
  };

  const ext = mimeToExt[contentType.split(';')[0]?.trim() ?? ''];
  if (ext) return ext;

  // Fallback: try to extract from URL path
  try {
    const pathname = new URL(url).pathname;
    const urlExt = pathname.split('.').pop()?.toLowerCase();
    if (urlExt && ['jpg', 'jpeg', 'png', 'gif', 'webp', 'svg', 'avif'].includes(urlExt)) {
      return urlExt === 'jpeg' ? 'jpg' : urlExt;
    }
  } catch {
    // ignore invalid URL
  }

  return 'jpg'; // Default fallback
}

// ---------------------------------------------------------------------------
// Main Extraction Entry Point
// ---------------------------------------------------------------------------

/**
 * Extract product data from an HTML page using multiple strategies.
 *
 * Strategies are attempted in priority order:
 * 1. JSON-LD structured data (schema.org/Product) — most reliable
 * 2. OpenGraph meta tags — good for single-product pages
 * 3. Common CSS selectors — fallback for unstructured pages
 *
 * @param html - Raw HTML content of the page
 * @param pageUrl - URL of the page (used for resolving relative URLs)
 * @param config - Extraction configuration
 * @returns Extraction result with products and strategy used
 */
export async function extractProductsFromHtml(
  html: string,
  pageUrl: string,
  config: HtmlExtractorConfig
): Promise<HtmlExtractionResult> {
  const $ = cheerio.load(html);

  // Strategy 1: JSON-LD structured data
  const jsonLdProducts = extractFromJsonLd($, pageUrl);
  if (jsonLdProducts.length > 0) {
    const products = await processExtractedProducts(jsonLdProducts, pageUrl, config);
    return { products, productCount: products.length, strategy: 'json-ld' };
  }

  // Strategy 2: OpenGraph meta tags
  const ogProduct = extractFromOpenGraph($, pageUrl);
  if (ogProduct) {
    const products = await processExtractedProducts([ogProduct], pageUrl, config);
    return { products, productCount: products.length, strategy: 'opengraph' };
  }

  // Strategy 3: Common CSS selectors
  const cssProducts = extractFromCssSelectors($, pageUrl);
  if (cssProducts.length > 0) {
    const products = await processExtractedProducts(cssProducts, pageUrl, config);
    return { products, productCount: products.length, strategy: 'css-selectors' };
  }

  return { products: [], productCount: 0, strategy: 'none' };
}

// ---------------------------------------------------------------------------
// Strategy 1: JSON-LD Structured Data (schema.org/Product)
// ---------------------------------------------------------------------------

/**
 * Extract product data from JSON-LD script tags containing schema.org/Product markup.
 */
export function extractFromJsonLd(
  $: cheerio.CheerioAPI,
  pageUrl: string
): Partial<HtmlExtractedProduct>[] {
  const products: Partial<HtmlExtractedProduct>[] = [];

  $('script[type="application/ld+json"]').each((_i, el) => {
    try {
      const text = $(el).text().trim();
      if (!text) return;

      const data = JSON.parse(text);
      const items = findProductsInJsonLd(data);

      for (const item of items) {
        const product = mapJsonLdToProduct(item, pageUrl);
        if (product.title || product.sku) {
          products.push(product);
        }
      }
    } catch {
      // Skip malformed JSON-LD blocks
    }
  });

  return products;
}

/**
 * Recursively find Product objects in a JSON-LD structure.
 * Handles @graph arrays and nested structures.
 */
function findProductsInJsonLd(data: unknown): Record<string, unknown>[] {
  const products: Record<string, unknown>[] = [];

  if (!data || typeof data !== 'object') return products;

  if (Array.isArray(data)) {
    for (const item of data) {
      products.push(...findProductsInJsonLd(item));
    }
    return products;
  }

  const obj = data as Record<string, unknown>;

  // Check if this object is a Product type
  const type = obj['@type'];
  if (type === 'Product' || (Array.isArray(type) && type.includes('Product'))) {
    products.push(obj);
    return products;
  }

  // Check @graph array
  if (Array.isArray(obj['@graph'])) {
    products.push(...findProductsInJsonLd(obj['@graph']));
  }

  return products;
}

/**
 * Map a schema.org/Product JSON-LD object to an HtmlExtractedProduct.
 */
function mapJsonLdToProduct(
  item: Record<string, unknown>,
  pageUrl: string
): Partial<HtmlExtractedProduct> {
  const product: Partial<HtmlExtractedProduct> = {
    images: [],
    sourceUrl: pageUrl,
  };

  // Name / title
  if (typeof item.name === 'string') {
    product.title = item.name;
  }

  // Description
  if (typeof item.description === 'string') {
    product.description = item.description;
  }

  // SKU
  if (typeof item.sku === 'string') {
    product.sku = item.sku;
  } else if (typeof item.productID === 'string') {
    product.sku = item.productID;
  } else if (typeof item.gtin13 === 'string') {
    product.sku = item.gtin13;
  } else if (typeof item.gtin === 'string') {
    product.sku = item.gtin;
  }

  // Brand
  if (typeof item.brand === 'string') {
    product.brand = item.brand;
  } else if (typeof item.brand === 'object' && item.brand !== null) {
    const brand = item.brand as Record<string, unknown>;
    if (typeof brand.name === 'string') {
      product.brand = brand.name;
    }
  }

  // Category
  if (typeof item.category === 'string') {
    product.category = item.category;
  }

  // Price — from offers
  const offers = item.offers;
  if (offers) {
    const offerData = Array.isArray(offers) ? offers[0] : offers;
    if (typeof offerData === 'object' && offerData !== null) {
      const offer = offerData as Record<string, unknown>;
      if (typeof offer.price === 'string' || typeof offer.price === 'number') {
        product.price = String(offer.price);
      }
      // Stock availability
      if (typeof offer.availability === 'string') {
        product.stockAvailability = normaliseAvailability(offer.availability);
      }
    }
  }

  // Images
  const images = extractImagesFromJsonLd(item, pageUrl);
  if (images.length > 0) {
    product.images = images;
  }

  // Variations
  const variations = extractVariationsFromJsonLd(item);
  if (variations.length > 0) {
    product.variations = variations;
  }

  // Specifications from additionalProperty
  const specs = extractSpecsFromJsonLd(item);
  if (Object.keys(specs).length > 0) {
    product.specifications = specs;
  }

  return product;
}

/**
 * Extract image URLs from a JSON-LD Product object.
 */
function extractImagesFromJsonLd(item: Record<string, unknown>, pageUrl: string): string[] {
  const images: string[] = [];
  const imageField = item.image;

  if (typeof imageField === 'string') {
    images.push(resolveUrl(imageField, pageUrl));
  } else if (Array.isArray(imageField)) {
    for (const img of imageField) {
      if (typeof img === 'string') {
        images.push(resolveUrl(img, pageUrl));
      } else if (typeof img === 'object' && img !== null) {
        const imgObj = img as Record<string, unknown>;
        if (typeof imgObj.url === 'string') {
          images.push(resolveUrl(imgObj.url, pageUrl));
        } else if (typeof imgObj.contentUrl === 'string') {
          images.push(resolveUrl(imgObj.contentUrl, pageUrl));
        }
      }
    }
  } else if (typeof imageField === 'object' && imageField !== null) {
    const imgObj = imageField as Record<string, unknown>;
    if (typeof imgObj.url === 'string') {
      images.push(resolveUrl(imgObj.url, pageUrl));
    } else if (typeof imgObj.contentUrl === 'string') {
      images.push(resolveUrl(imgObj.contentUrl, pageUrl));
    }
  }

  return images;
}

/**
 * Extract product variations from JSON-LD (e.g. from hasVariant or offers).
 */
function extractVariationsFromJsonLd(item: Record<string, unknown>): ProductVariation[] {
  const variations: ProductVariation[] = [];

  // Check hasVariant (schema.org pattern)
  const hasVariant = item.hasVariant;
  if (Array.isArray(hasVariant)) {
    for (const variant of hasVariant) {
      if (typeof variant === 'object' && variant !== null) {
        const v = variant as Record<string, unknown>;
        const name = typeof v.name === 'string' ? v.name : '';
        const sku = typeof v.sku === 'string' ? v.sku : undefined;
        let price: string | undefined;
        if (v.offers && typeof v.offers === 'object') {
          const offer = (Array.isArray(v.offers) ? v.offers[0] : v.offers) as Record<string, unknown>;
          if (typeof offer?.price === 'string' || typeof offer?.price === 'number') {
            price = String(offer.price);
          }
        }
        if (name) {
          variations.push({ name: 'variant', value: name, sku, price });
        }
      }
    }
  }

  // Check offers array for variant-like pricing
  const offers = item.offers;
  if (Array.isArray(offers) && offers.length > 1 && variations.length === 0) {
    for (const offer of offers) {
      if (typeof offer === 'object' && offer !== null) {
        const o = offer as Record<string, unknown>;
        const name = typeof o.name === 'string' ? o.name : '';
        const sku = typeof o.sku === 'string' ? o.sku : undefined;
        const price = typeof o.price === 'string' || typeof o.price === 'number' ? String(o.price) : undefined;
        if (name) {
          variations.push({ name: 'option', value: name, sku, price });
        }
      }
    }
  }

  return variations;
}

/**
 * Extract product specifications from JSON-LD additionalProperty array.
 */
function extractSpecsFromJsonLd(item: Record<string, unknown>): Record<string, string> {
  const specs: Record<string, string> = {};

  const additionalProperty = item.additionalProperty;
  if (Array.isArray(additionalProperty)) {
    for (const prop of additionalProperty) {
      if (typeof prop === 'object' && prop !== null) {
        const p = prop as Record<string, unknown>;
        const name = typeof p.name === 'string' ? p.name : '';
        const value = typeof p.value === 'string' ? p.value : String(p.value ?? '');
        if (name && value) {
          specs[name] = value;
        }
      }
    }
  }

  return specs;
}

// ---------------------------------------------------------------------------
// Strategy 2: OpenGraph Meta Tags
// ---------------------------------------------------------------------------

/**
 * Extract product data from OpenGraph (og:) and product-specific (product:) meta tags.
 * Typically yields a single product for the page.
 */
export function extractFromOpenGraph(
  $: cheerio.CheerioAPI,
  pageUrl: string
): Partial<HtmlExtractedProduct> | null {
  const getMetaContent = (property: string): string | undefined => {
    const content = $(`meta[property="${property}"]`).attr('content');
    return content?.trim() || undefined;
  };

  const title = getMetaContent('og:title') ?? getMetaContent('product:title');
  const description = getMetaContent('og:description');
  const ogImage = getMetaContent('og:image');
  const price = getMetaContent('product:price:amount') ?? getMetaContent('og:price:amount');
  const brand = getMetaContent('product:brand');
  const category = getMetaContent('product:category');
  const sku = getMetaContent('product:retailer_item_id');
  const availability = getMetaContent('product:availability');

  // OpenGraph must at least have a title to be useful
  if (!title) return null;

  const images: string[] = [];
  if (ogImage) {
    images.push(resolveUrl(ogImage, pageUrl));
  }
  // Collect additional og:image tags
  $('meta[property="og:image"]').each((_i, el) => {
    const content = $(el).attr('content')?.trim();
    if (content && !images.includes(resolveUrl(content, pageUrl))) {
      images.push(resolveUrl(content, pageUrl));
    }
  });

  return {
    title,
    description,
    sku,
    brand,
    category,
    price,
    images,
    stockAvailability: availability ? normaliseAvailability(availability) : undefined,
    sourceUrl: pageUrl,
    sourceRowIndex: 1,
  };
}

// ---------------------------------------------------------------------------
// Strategy 3: Common CSS Selectors
// ---------------------------------------------------------------------------

/** CSS selector sets for common product page patterns. */
const TITLE_SELECTORS = [
  'h1[itemprop="name"]',
  '[data-testid="product-title"]',
  '.product-title',
  '.product-name',
  '.product_title',
  '#product-title',
  '#productTitle',
  'h1.title',
  '.pdp-title',
  'h1',
];

const PRICE_SELECTORS = [
  '[itemprop="price"]',
  '[data-testid="product-price"]',
  '.product-price',
  '.price',
  '.product_price',
  '#product-price',
  '#priceblock_ourprice',
  '.sale-price',
  '.current-price',
  '.offer-price',
  'span.price',
  '.pdp-price',
];

const DESCRIPTION_SELECTORS = [
  '[itemprop="description"]',
  '[data-testid="product-description"]',
  '.product-description',
  '.product_description',
  '#product-description',
  '#productDescription',
  '.description',
  '.pdp-description',
];

const SKU_SELECTORS = [
  '[itemprop="sku"]',
  '[data-testid="product-sku"]',
  '.product-sku',
  '.sku',
  '#product-sku',
  '.product_sku',
];

const BRAND_SELECTORS = [
  '[itemprop="brand"]',
  '[data-testid="product-brand"]',
  '.product-brand',
  '.brand',
  '#product-brand',
];

const CATEGORY_SELECTORS = [
  '[itemprop="category"]',
  '.breadcrumb',
  '.breadcrumbs',
  'nav[aria-label="breadcrumb"]',
];

const IMAGE_SELECTORS = [
  '[itemprop="image"]',
  '.product-image img',
  '.product-gallery img',
  '.product_image img',
  '#product-image img',
  '.pdp-image img',
  '.gallery img',
  '.carousel img',
  'img[data-testid="product-image"]',
  '.main-image img',
];

const STOCK_SELECTORS = [
  '[itemprop="availability"]',
  '.stock-status',
  '.availability',
  '#availability',
  '.product-availability',
  '.in-stock',
  '.out-of-stock',
];

/**
 * Extract product data using common CSS selectors found on e-commerce product pages.
 * This is the fallback strategy when structured data is not available.
 */
export function extractFromCssSelectors(
  $: cheerio.CheerioAPI,
  pageUrl: string
): Partial<HtmlExtractedProduct>[] {
  const title = findFirstText($, TITLE_SELECTORS);
  const price = findFirstText($, PRICE_SELECTORS);
  const description = findFirstText($, DESCRIPTION_SELECTORS);
  const sku = findFirstAttrOrText($, SKU_SELECTORS, 'content');
  const brand = findFirstText($, BRAND_SELECTORS);
  const category = extractBreadcrumbCategory($, CATEGORY_SELECTORS);
  const stockAvailability = findFirstText($, STOCK_SELECTORS);
  const images = extractImages($, IMAGE_SELECTORS, pageUrl);
  const specifications = extractSpecsFromTable($);

  // Must have at least a title to consider this a valid product extraction
  if (!title) return [];

  const product: Partial<HtmlExtractedProduct> = {
    title,
    price: price ? cleanPriceText(price) : undefined,
    description,
    sku,
    brand,
    category,
    images,
    stockAvailability: stockAvailability ? normaliseAvailability(stockAvailability) : undefined,
    specifications: Object.keys(specifications).length > 0 ? specifications : undefined,
    sourceUrl: pageUrl,
    sourceRowIndex: 1,
  };

  return [product];
}

// ---------------------------------------------------------------------------
// CSS Selector Helpers
// ---------------------------------------------------------------------------

/**
 * Find the first non-empty text content matching any of the given selectors.
 */
function findFirstText($: cheerio.CheerioAPI, selectors: string[]): string | undefined {
  for (const selector of selectors) {
    const el = $(selector).first();
    if (el.length > 0) {
      const text = el.text().trim();
      if (text) return text;
    }
  }
  return undefined;
}

/**
 * Find the first value from either an attribute or text content using selectors.
 */
function findFirstAttrOrText(
  $: cheerio.CheerioAPI,
  selectors: string[],
  attr: string
): string | undefined {
  for (const selector of selectors) {
    const el = $(selector).first();
    if (el.length > 0) {
      const attrValue = el.attr(attr)?.trim();
      if (attrValue) return attrValue;
      const text = el.text().trim();
      if (text) return text;
    }
  }
  return undefined;
}

/**
 * Extract breadcrumb category from navigation elements.
 * Returns the last meaningful breadcrumb item as the category.
 */
function extractBreadcrumbCategory(
  $: cheerio.CheerioAPI,
  selectors: string[]
): string | undefined {
  for (const selector of selectors) {
    const el = $(selector).first();
    if (el.length > 0) {
      // Get all list items or links within the breadcrumb
      const items = el.find('li, a').toArray();
      const texts = items
        .map((item) => $(item).text().trim())
        .filter((text) => text && text !== '/' && text !== '>' && text !== 'Home');

      // Return the last item (most specific category), excluding the product name
      if (texts.length >= 2) {
        return texts[texts.length - 2]; // Second to last (last is usually product name)
      }
      if (texts.length === 1) {
        return texts[0];
      }
    }
  }
  return undefined;
}

/**
 * Extract product images from the page using common image selectors.
 * Returns absolute URLs for all found images.
 */
function extractImages(
  $: cheerio.CheerioAPI,
  selectors: string[],
  pageUrl: string
): string[] {
  const images: string[] = [];
  const seen = new Set<string>();

  for (const selector of selectors) {
    $(selector).each((_i, el) => {
      const tag = $(el);
      // Check src, data-src, data-lazy-src (for lazy-loaded images)
      const src = tag.attr('src') ?? tag.attr('data-src') ?? tag.attr('data-lazy-src');
      if (src) {
        const resolved = resolveUrl(src, pageUrl);
        if (!seen.has(resolved) && isProductImage(resolved)) {
          seen.add(resolved);
          images.push(resolved);
        }
      }

      // Also check srcset for high-res images
      const srcset = tag.attr('srcset');
      if (srcset) {
        const firstUrl = parseSrcsetFirstUrl(srcset);
        if (firstUrl) {
          const resolved = resolveUrl(firstUrl, pageUrl);
          if (!seen.has(resolved) && isProductImage(resolved)) {
            seen.add(resolved);
            images.push(resolved);
          }
        }
      }
    });

    // If we found images with this selector, don't fall through to less specific ones
    if (images.length > 0) break;
  }

  return images;
}

/**
 * Extract product specifications from HTML tables (common pattern on e-commerce sites).
 */
function extractSpecsFromTable($: cheerio.CheerioAPI): Record<string, string> {
  const specs: Record<string, string> = {};

  // Look for specification/details tables
  const tableSelectors = [
    'table.specifications',
    'table.product-specs',
    'table.product-details',
    '#specifications table',
    '#product-specs table',
    '.spec-table',
    '[itemprop="additionalProperty"]',
  ];

  for (const selector of tableSelectors) {
    $(selector).find('tr').each((_i, row) => {
      const cells = $(row).find('th, td');
      if (cells.length >= 2) {
        const key = $(cells[0]).text().trim();
        const value = $(cells[1]).text().trim();
        if (key && value) {
          specs[key] = value;
        }
      }
    });
    if (Object.keys(specs).length > 0) break;
  }

  return specs;
}

// ---------------------------------------------------------------------------
// Utility Functions
// ---------------------------------------------------------------------------

/**
 * Resolve a potentially relative URL against a base URL.
 */
export function resolveUrl(url: string, baseUrl: string): string {
  if (!url) return '';
  try {
    // Already absolute
    if (url.startsWith('http://') || url.startsWith('https://')) {
      return url;
    }
    // Protocol-relative
    if (url.startsWith('//')) {
      const base = new URL(baseUrl);
      return `${base.protocol}${url}`;
    }
    // Relative URL
    return new URL(url, baseUrl).href;
  } catch {
    return url;
  }
}

/**
 * Check if a URL looks like a product image (not a tracking pixel, icon, etc.)
 */
function isProductImage(url: string): boolean {
  // Skip data URIs, tracking pixels, and tiny icons
  if (url.startsWith('data:')) return false;

  const lowerUrl = url.toLowerCase();

  // Skip common non-product images
  const skipPatterns = [
    '/pixel', '/tracking', '/beacon',
    '/favicon', '/icon', '/logo',
    '/sprite', '/spacer', '/blank',
    '1x1', 'transparent.gif', 'transparent.png',
  ];

  for (const pattern of skipPatterns) {
    if (lowerUrl.includes(pattern)) return false;
  }

  return true;
}

/**
 * Parse the first URL from a srcset attribute.
 * srcset format: "url1 1x, url2 2x, url3 3x" or "url1 300w, url2 600w"
 */
function parseSrcsetFirstUrl(srcset: string): string | undefined {
  const parts = srcset.split(',').map((s) => s.trim());
  // Pick the largest (last) entry for best quality
  const lastEntry = parts[parts.length - 1];
  if (!lastEntry) return undefined;
  const urlPart = lastEntry.split(/\s+/)[0];
  return urlPart?.trim() || undefined;
}

/**
 * Clean price text extracted from the DOM (remove extra whitespace, newlines).
 */
function cleanPriceText(text: string): string {
  return text.replace(/\s+/g, ' ').trim();
}

/**
 * Normalise availability values from various formats (schema.org URLs, text) to
 * a human-readable string.
 */
function normaliseAvailability(availability: string): string {
  const lower = availability.toLowerCase();

  // schema.org availability URLs and common text patterns
  if (lower.includes('instock') || lower.includes('in_stock') || lower.includes('in stock')) return 'In Stock';
  if (lower.includes('outofstock') || lower.includes('out_of_stock') || lower.includes('out of stock')) return 'Out of Stock';
  if (lower.includes('preorder') || lower.includes('pre_order') || lower.includes('pre-order')) return 'Pre-Order';
  if (lower.includes('limitedavailability') || lower.includes('limited availability')) return 'Limited Availability';
  if (lower.includes('discontinued')) return 'Discontinued';
  if (lower.includes('backorder') || lower.includes('back_order') || lower.includes('back order')) return 'Back Order';

  // Return cleaned-up text if no pattern matched
  return availability.trim();
}

// ---------------------------------------------------------------------------
// Post-Processing: Image Download and Record Finalization
// ---------------------------------------------------------------------------

/**
 * Process extracted products: optionally download images and assign source row indices.
 */
async function processExtractedProducts(
  rawProducts: Partial<HtmlExtractedProduct>[],
  pageUrl: string,
  config: HtmlExtractorConfig
): Promise<HtmlExtractedProduct[]> {
  const products: HtmlExtractedProduct[] = [];

  for (let i = 0; i < rawProducts.length; i++) {
    const raw = rawProducts[i]!;
    let images = raw.images ?? [];

    // Download images to S3 if configured
    if (config.downloadImages !== false && images.length > 0) {
      const storedImages: string[] = [];
      for (const imageUrl of images) {
        const s3Key = await downloadAndStoreImage(imageUrl, config);
        if (s3Key) {
          storedImages.push(s3Key);
        }
      }
      // Keep original URLs if no images were successfully downloaded
      if (storedImages.length > 0) {
        images = storedImages;
      }
    }

    const product: HtmlExtractedProduct = {
      title: raw.title,
      sku: raw.sku,
      price: raw.price,
      description: raw.description,
      brand: raw.brand,
      category: raw.category,
      images,
      sourceRowIndex: i + 1,
      sourceUrl: pageUrl,
      stockAvailability: raw.stockAvailability,
      variations: raw.variations,
      specifications: raw.specifications,
    };

    products.push(product);
  }

  return products;
}
