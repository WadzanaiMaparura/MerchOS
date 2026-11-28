/**
 * Store exports (Exports page): the seller picks a store and up to 500 of their
 * products; the server loads them, checks them against that store's rules,
 * builds the file, re-reads it, keeps it in the export history and remembers
 * per-product choices (Shopify handle, export date).
 *
 *   check   -> per product: Ready or Needs fixing (with plain messages)
 *   create  -> the file (only Ready products when the seller asks for that)
 *
 * Takealot keeps its schema-driven validation and loadsheet (ExportService);
 * it now also gets real image links, Inventory stock and many products.
 */

import { randomBytes } from 'node:crypto';
import type { CanonicalProduct, ValidationResult } from '@merch-os/types';
import { buildShopifyTable, checkShopify } from '../channels/shopify.js';
import { shopifyCategoryPath } from '../channels/shopify-taxonomy.js';
import { buildWooTable, checkWoo } from '../channels/woocommerce.js';
import { TEMPLATE_VERSIONS, type ChannelFinding, type ExportChannel, type ExportProduct, type ShopifyOptions, type WooOptions } from '../channels/types.js';
import { serializeCsv } from '../engine/csv.js';
import { assertRectangular, parseCsv } from '../engine/csv-parse.js';
import { imageRefsFor, toExportProduct } from '../data/prepare.js';
import type { ProductStorePort, StoredProduct } from '../data/product-store.js';
import { newExportId, type ExportArchivePort, type ExportManifest } from '../data/archive.js';
import { IMAGE_LINK_DAYS } from '../data/image-links.js';
import { ExportBlockedError, ExportSchemaNotFoundError, ExportService, type ExportRequest } from './export-service.js';

export const MAX_EXPORT_PRODUCTS = 500;
/** Download links from the history are made fresh and work this long. */
export const DOWNLOAD_LINK_SECONDS = 15 * 60;

export interface ChannelOptions {
  shopify?: { status?: 'draft' | 'active'; useRrpAsCompareAt?: boolean };
  woocommerce?: {
    status?: 'draft' | 'published';
    weightUnit?: WooOptions['weightUnit'];
    dimensionUnit?: WooOptions['dimensionUnit'];
    useRrpAsCompareAt?: boolean;
  };
  takealot?: { category?: string; format?: 'CSV' | 'XLSX' };
}

export interface ChannelExportRequest {
  channel: ExportChannel;
  productIds: string[];
  options?: ChannelOptions;
  /** create: export the Ready products and leave the rest out. */
  onlyReady?: boolean;
}

export interface ProductCheck {
  productId: string;
  title: string;
  sku: string;
  status: 'ready' | 'needs-fixing';
  findings: ChannelFinding[];
  /** Current per-store choices, so the page can show and change them. */
  shopifyCategory: string | null;
  /** Full breadcrumb of shopifyCategory (when it is in the bundled list). */
  shopifyCategoryPath: string | null;
  woocommerceCategory: string | null;
  categoryPath: string | null;
}

export interface CheckResponse {
  channel: ExportChannel;
  templateVersion: string;
  products: ProductCheck[];
  readyCount: number;
  needsFixingCount: number;
  /** Ids that are not this seller's products (or no longer exist). */
  missingProductIds: string[];
}

export class ExportRequestError extends Error {
  constructor(public readonly code: string, message: string, public readonly status = 400) {
    super(message);
    this.name = 'ExportRequestError';
  }
}

/** A create that would leave products out without the seller agreeing to it. */
export class ExportNeedsFixingError extends Error {
  constructor(public readonly check: CheckResponse) {
    super('Some products need fixing before they can be exported.');
    this.name = 'ExportNeedsFixingError';
  }
}

export interface ChannelExportDeps {
  store: ProductStorePort;
  archive: ExportArchivePort;
  /** Builds the image linker (CloudFront signing) for links expiring at `expiresAt`. */
  imageLinker: (expiresAt: Date) => Promise<(s3Key: string) => string>;
  takealot?: ExportService;
  now?: () => Date;
  random?: () => string;
}

/** YYYY-MM-DD in South Africa. */
export function saDate(d: Date): string {
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'Africa/Johannesburg' }).format(d);
}

function validateRequest(req: ChannelExportRequest): string[] {
  if (!['takealot', 'shopify', 'woocommerce'].includes(req.channel)) {
    throw new ExportRequestError('UNSUPPORTED_CHANNEL', 'Choose Takealot, Shopify or WooCommerce.');
  }
  const ids = [...new Set((req.productIds ?? []).filter((v) => typeof v === 'string' && /^[A-Za-z0-9-]{1,64}$/.test(v)))];
  if (ids.length === 0) throw new ExportRequestError('NO_PRODUCTS', 'Choose at least one product.');
  if (ids.length > MAX_EXPORT_PRODUCTS) {
    throw new ExportRequestError('TOO_MANY_PRODUCTS', `Choose at most ${MAX_EXPORT_PRODUCTS} products at a time.`);
  }
  return ids;
}

function shopifyOptions(o: ChannelOptions | undefined, today: string): ShopifyOptions {
  return { status: o?.shopify?.status === 'active' ? 'active' : 'draft', useRrpAsCompareAt: o?.shopify?.useRrpAsCompareAt === true, today };
}

function wooOptions(o: ChannelOptions | undefined, today: string): WooOptions {
  const w = o?.woocommerce;
  return {
    status: w?.status === 'published' ? 'published' : 'draft',
    weightUnit: w?.weightUnit && ['kg', 'g', 'lbs', 'oz'].includes(w.weightUnit) ? w.weightUnit : 'kg',
    dimensionUnit: w?.dimensionUnit && ['cm', 'm', 'mm', 'in', 'yd'].includes(w.dimensionUnit) ? w.dimensionUnit : 'cm',
    useRrpAsCompareAt: w?.useRrpAsCompareAt === true,
    today,
  };
}

/** Findings that only show across the whole file (the same SKU twice). */
function duplicateSkuFindings(products: ExportProduct[]): Map<string, ChannelFinding[]> {
  const owners = new Map<string, string[]>();
  for (const p of products) {
    const skus = new Set<string>([p.product.content.sku, ...(p.product.content.variants ?? []).map((v) => v.sku)].filter(Boolean));
    for (const s of skus) owners.set(s, [...(owners.get(s) ?? []), p.product.productId]);
  }
  const out = new Map<string, ChannelFinding[]>();
  for (const [sku, ids] of owners) {
    if (ids.length < 2) continue;
    for (const id of ids) {
      out.set(id, [
        ...(out.get(id) ?? []),
        { severity: 'ERROR', code: 'SKU_IN_ANOTHER_PRODUCT', field: 'SKU', message: `The SKU ${sku} is also used by another product in this export.` },
      ]);
    }
  }
  return out;
}

function takealotFindings(r: ValidationResult): ChannelFinding[] {
  return r.findings
    .filter((f) => f.severity !== 'INFO')
    .map((f) => ({
      severity: f.severity === 'ERROR' ? ('ERROR' as const) : ('WARNING' as const),
      code: f.code,
      field: f.platformField || f.field,
      message: f.suggestion ? `${f.message} ${f.suggestion}` : f.message,
    }));
}

export class ChannelExportService {
  private readonly now: () => Date;
  private readonly random: () => string;
  private readonly takealot: ExportService;

  constructor(private readonly deps: ChannelExportDeps) {
    this.now = deps.now ?? (() => new Date());
    this.random = deps.random ?? (() => randomBytes(4).toString('hex'));
    this.takealot = deps.takealot ?? new ExportService();
  }

  private async prepare(tenantId: string, req: ChannelExportRequest, expiresAt: Date) {
    const ids = validateRequest(req);
    const [stored, stock, link] = await Promise.all([
      this.deps.store.loadProducts(tenantId, ids),
      this.deps.store.loadStock(tenantId),
      this.deps.imageLinker(expiresAt),
    ]);
    const found = ids.filter((id) => stored.has(id));
    const missing = ids.filter((id) => !stored.has(id));
    const products = found.map((id) => {
      const s = stored.get(id)!;
      return toExportProduct(s.product, s.enrichment, stock, req.channel, link);
    });
    return { products, missing, stored, link, stock };
  }

  /** Per-product checks for one store. */
  async check(tenantId: string, req: ChannelExportRequest): Promise<CheckResponse> {
    const now = this.now();
    const { products, missing, stored, link, stock } = await this.prepare(tenantId, req, this.linkExpiry(now));
    const today = saDate(now);
    const results = new Map<string, ChannelFinding[]>();

    if (req.channel === 'takealot') {
      const byId = await this.takealotCheck(products, stored, stock, link, req.options);
      for (const [id, f] of byId) results.set(id, f);
    } else {
      const extra = duplicateSkuFindings(products);
      for (const p of products) {
        const own =
          req.channel === 'shopify' ? checkShopify(p, shopifyOptions(req.options, today)) : checkWoo(p, wooOptions(req.options, today));
        results.set(p.product.productId, [...own, ...(extra.get(p.product.productId) ?? [])]);
      }
    }

    const checks: ProductCheck[] = products.map((p) => {
      const findings = results.get(p.product.productId) ?? [];
      return {
        productId: p.product.productId,
        title: p.product.content.title ?? '',
        sku: p.product.content.sku ?? '',
        status: findings.some((f) => f.severity === 'ERROR') ? 'needs-fixing' : 'ready',
        findings,
        shopifyCategory: p.product.platformSpecific?.categoryMappings?.shopify ?? null,
        shopifyCategoryPath: shopifyCategoryPath(p.product.platformSpecific?.categoryMappings?.shopify ?? '') ?? null,
        woocommerceCategory: p.product.platformSpecific?.categoryMappings?.woocommerce ?? null,
        categoryPath: p.categoryPath,
      };
    });
    return {
      channel: req.channel,
      templateVersion: TEMPLATE_VERSIONS[req.channel],
      products: checks,
      readyCount: checks.filter((c) => c.status === 'ready').length,
      needsFixingCount: checks.filter((c) => c.status === 'needs-fixing').length,
      missingProductIds: missing,
    };
  }

  /** Builds, re-reads, stores and records the file. */
  async create(tenantId: string, userId: string | null, req: ChannelExportRequest): Promise<{ manifest: ExportManifest; downloadUrl: string; check: CheckResponse }> {
    const now = this.now();
    const expiresAt = this.linkExpiry(now);
    const check = await this.check(tenantId, req);
    if (check.needsFixingCount > 0 && !req.onlyReady) throw new ExportNeedsFixingError(check);
    const readyIds = new Set(check.products.filter((c) => c.status === 'ready').map((c) => c.productId));
    if (readyIds.size === 0) throw new ExportNeedsFixingError(check);

    const { products, stored, link, stock } = await this.prepare(tenantId, { ...req, productIds: [...readyIds] }, expiresAt);
    const today = saDate(now);
    const exportId = newExportId(now, this.random());
    const stamp = exportId.slice(0, 13).replace('T', '-');

    let body: string | Buffer;
    let filename: string;
    let format: 'CSV' | 'XLSX' = 'CSV';
    let rowCount: number;
    let handles: string[] = [];

    if (req.channel === 'takealot') {
      const out = await this.takealotExport(products, stored, stock, link, req.options);
      body = out.content;
      format = out.format;
      filename = out.filename;
      rowCount = out.rowCount;
    } else {
      const table =
        req.channel === 'shopify'
          ? buildShopifyTable(products, shopifyOptions(req.options, today))
          : buildWooTable(products, wooOptions(req.options, today));
      if ('handles' in table) handles = table.handles as string[];
      body = serializeCsv(table.columns, table.rows);
      filename = `${req.channel}-products-${stamp}-${products.length}.csv`;
      rowCount = table.rows.length;
    }

    // Re-read the file: a broken quote or a short row never reaches a seller.
    if (format === 'CSV') {
      const reread = parseCsv(body as string);
      assertRectangular(reread);
      if (reread.length !== rowCount + 1) throw new Error(`Export self-check failed: ${reread.length - 1} rows read back, ${rowCount} written`);
    }

    const manifest: ExportManifest = {
      exportId,
      channel: req.channel,
      templateVersion: TEMPLATE_VERSIONS[req.channel],
      format,
      filename,
      createdAt: now.toISOString(),
      createdBy: userId,
      productCount: products.length,
      rowCount,
      excludedCount: check.needsFixingCount,
      imageLinksExpireAt: expiresAt.toISOString(),
    };
    await this.deps.archive.save(tenantId, manifest, body);

    // Remember the export (and the Shopify handle) on each product. Best effort:
    // the file is already safe in the history.
    await Promise.allSettled(
      products.map((p, i) =>
        this.deps.store.recordExport(tenantId, p.product.productId, req.channel, {
          date: manifest.createdAt,
          version: manifest.templateVersion,
          ...(handles[i] ? { shopifyHandle: handles[i] } : {}),
        })
      )
    );

    return { manifest, downloadUrl: await this.deps.archive.downloadUrl(tenantId, manifest, DOWNLOAD_LINK_SECONDS), check };
  }

  private linkExpiry(now: Date): Date {
    return new Date(now.getTime() + IMAGE_LINK_DAYS * 24 * 3600 * 1000);
  }

  // -------------------------------------------------------------------------
  // Takealot (schema-driven loadsheet)
  // -------------------------------------------------------------------------

  private takealotRequest(
    products: ExportProduct[],
    stored: Map<string, StoredProduct>,
    stock: Record<string, number>,
    link: (k: string) => string,
    options: ChannelOptions | undefined,
    partial: boolean
  ): ExportRequest {
    const chosen = options?.takealot?.category?.trim() || undefined;
    return {
      mode: 'full-create',
      format: options?.takealot?.format === 'XLSX' ? 'XLSX' : 'CSV',
      partial,
      imageUrlResolver: link,
      products: products.map((p) => {
        const original = stored.get(p.product.productId)!.product;
        // Only Takealot's image copy (or the main image), never other stores' copies.
        const product: CanonicalProduct = {
          ...original,
          content: { ...original.content, attributes: { ...p.attributes }, imageRefs: imageRefsFor(original, 'takealot') },
        };
        const category = chosen ?? original.platformSpecific?.categoryMappings?.takealot ?? undefined;
        const sku = original.content.sku;
        return {
          product,
          ...(category ? { category } : {}),
          ...(sku && sku in stock ? { offer: { stockOnHand: stock[sku]! } } : {}),
        };
      }),
    };
  }

  private async takealotCheck(
    products: ExportProduct[],
    stored: Map<string, StoredProduct>,
    stock: Record<string, number>,
    link: (k: string) => string,
    options: ChannelOptions | undefined
  ): Promise<Map<string, ChannelFinding[]>> {
    const out = new Map<string, ChannelFinding[]>();
    try {
      const res = await this.takealot.export(this.takealotRequest(products, stored, stock, link, options, true));
      for (const r of [...res.validated, ...res.excluded]) out.set(r.productId, takealotFindings(r));
    } catch (e) {
      if (e instanceof ExportBlockedError) {
        for (const r of e.validationResults) out.set(r.productId, takealotFindings(r));
      } else if (e instanceof ExportSchemaNotFoundError) {
        for (const p of products) {
          out.set(p.product.productId, [
            { severity: 'ERROR', code: 'TAKEALOT_CATEGORY', field: 'Category', message: 'Choose the Takealot category, including its number in brackets, for example Accessories->Eyewear (29451).' },
          ]);
        }
      } else {
        throw e;
      }
    }
    return out;
  }

  private async takealotExport(
    products: ExportProduct[],
    stored: Map<string, StoredProduct>,
    stock: Record<string, number>,
    link: (k: string) => string,
    options: ChannelOptions | undefined
  ) {
    const res = await this.takealot.export(this.takealotRequest(products, stored, stock, link, options, false));
    const o = res.output;
    return { content: o.content, format: o.format, filename: o.filename, rowCount: o.rowCount };
  }
}
