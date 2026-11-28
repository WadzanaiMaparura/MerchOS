/**
 * Store exports API (Exports page). The seller is ALWAYS the signed-in user:
 * tenant and user come from the Cognito token (custom:tenantId, sub), never
 * from the request.
 *
 *   POST /exports/check                          { channel, productIds, options }
 *   POST /exports                                { channel, productIds, options, onlyReady }
 *   GET  /exports                                export history (newest first)
 *   GET  /exports/{exportId}/download            a fresh 15-minute download link
 *   PUT  /exports/products/{productId}/category  { channel, value }  remember a store category
 *   GET  /exports/shopify-categories?q=mug       search Shopify's category list
 */

import type { APIGatewayProxyEventV2, APIGatewayProxyResultV2 } from 'aws-lambda';
import { S3ExportArchive, isExportId } from '../../data/archive.js';
import { imageLinker, loadSigningKey } from '../../data/image-links.js';
import { DynamoProductStore } from '../../data/product-store.js';
import { searchShopifyCategories, shopifyCategoryPath, SHOPIFY_TAXONOMY_VERSION } from '../../channels/shopify-taxonomy.js';
import {
  ChannelExportService,
  DOWNLOAD_LINK_SECONDS,
  ExportNeedsFixingError,
  ExportRequestError,
  type ChannelExportRequest,
} from '../channel-export-service.js';
import type { ExportChannel } from '../../channels/types.js';

let service: ChannelExportService | undefined;
let archive: S3ExportArchive | undefined;
let store: DynamoProductStore | undefined;

/** Test seam. */
export function setChannelExportDeps(deps: { service?: ChannelExportService; archive?: S3ExportArchive; store?: DynamoProductStore }): void {
  service = deps.service;
  archive = deps.archive;
  store = deps.store;
}

function env(name: string): string {
  const v = process.env[name];
  if (!v) throw new Error(`${name} is not configured`);
  return v;
}

function resolve() {
  store ??= new DynamoProductStore(env('PRODUCTS_TABLE'), env('INVENTORY_TABLE'));
  archive ??= new S3ExportArchive(env('EXPORTS_BUCKET'), process.env['PLATFORM_KMS_KEY_ARN']);
  service ??= new ChannelExportService({
    store,
    archive,
    imageLinker: async (expiresAt) =>
      imageLinker({
        domain: env('CLOUDFRONT_DOMAIN'),
        keyPairId: env('CLOUDFRONT_KEY_PAIR_ID'),
        privateKey: await loadSigningKey(env('CLOUDFRONT_PRIVATE_KEY_SECRET_ID')),
        expiresAt,
      }),
  });
  return { service, archive, store };
}

function json(statusCode: number, body: unknown): APIGatewayProxyResultV2 {
  return { statusCode, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) };
}

function error(statusCode: number, code: string, message: string, extra?: Record<string, unknown>) {
  return json(statusCode, { error: { code, message, ...extra } });
}

/** Tenant + user from the Cognito JWT authorizer only. */
export function identity(event: APIGatewayProxyEventV2): { tenantId: string; userId: string | null } | null {
  const claims = (event.requestContext as unknown as { authorizer?: { jwt?: { claims?: Record<string, unknown> } } })
    .authorizer?.jwt?.claims;
  const tenantId = claims?.['custom:tenantId'];
  if (typeof tenantId !== 'string' || !tenantId) return null;
  const sub = claims?.['sub'];
  return { tenantId, userId: typeof sub === 'string' ? sub : null };
}

function body<T>(event: APIGatewayProxyEventV2): T | null {
  if (!event.body) return null;
  try {
    const raw = event.isBase64Encoded ? Buffer.from(event.body, 'base64').toString('utf8') : event.body;
    return JSON.parse(raw) as T;
  } catch {
    return null;
  }
}

const CHANNELS: ExportChannel[] = ['takealot', 'shopify', 'woocommerce'];

export async function handler(event: APIGatewayProxyEventV2): Promise<APIGatewayProxyResultV2> {
  const who = identity(event);
  if (!who) return error(401, 'MISSING_TENANT', 'Sign in again to export.');
  const route = event.routeKey;

  try {
    const deps = resolve();

    if (route === 'POST /exports/check' || route === 'POST /exports') {
      const req = body<ChannelExportRequest>(event);
      if (!req) return error(400, 'VALIDATION_ERROR', 'The request is not valid JSON.');
      if (route === 'POST /exports/check') return json(200, await deps.service.check(who.tenantId, req));
      const res = await deps.service.create(who.tenantId, who.userId, req);
      return json(201, { export: res.manifest, downloadUrl: res.downloadUrl, expiresInSeconds: DOWNLOAD_LINK_SECONDS, check: res.check });
    }

    if (route === 'GET /exports') {
      return json(200, { exports: await deps.archive.list(who.tenantId, 25) });
    }

    if (route === 'GET /exports/{exportId}/download') {
      const id = event.pathParameters?.['exportId'] ?? '';
      const manifest = isExportId(id) ? await deps.archive.get(who.tenantId, id) : null;
      if (!manifest) return error(404, 'NOT_FOUND', 'That export was not found. Older exports are removed after 90 days.');
      return json(200, {
        downloadUrl: await deps.archive.downloadUrl(who.tenantId, manifest, DOWNLOAD_LINK_SECONDS),
        expiresInSeconds: DOWNLOAD_LINK_SECONDS,
        filename: manifest.filename,
      });
    }

    if (route === 'PUT /exports/products/{productId}/category') {
      const productId = event.pathParameters?.['productId'] ?? '';
      const b = body<{ channel?: string; value?: string | null }>(event);
      if (!/^[A-Za-z0-9-]{1,64}$/.test(productId) || !b || !CHANNELS.includes(b.channel as ExportChannel)) {
        return error(400, 'VALIDATION_ERROR', 'Choose a store and a category.');
      }
      const channel = b.channel as ExportChannel;
      const value = typeof b.value === 'string' ? b.value.trim() : null;
      if (value && value.length > 300) return error(400, 'VALIDATION_ERROR', 'That category is too long.');
      if (channel === 'shopify' && value && !shopifyCategoryPath(value)) {
        return error(400, 'CATEGORY_UNKNOWN', 'That is not a Shopify category. Pick one from the list.');
      }
      try {
        await deps.store.saveChannelCategory(who.tenantId, productId, channel, value || null);
      } catch (e) {
        if ((e as { name?: string }).name === 'ConditionalCheckFailedException') return error(404, 'NOT_FOUND', 'Product not found.');
        throw e;
      }
      return json(200, { productId, channel, value: value || null, ...(channel === 'shopify' && value ? { path: shopifyCategoryPath(value) } : {}) });
    }

    if (route === 'GET /exports/shopify-categories') {
      const q = (event.queryStringParameters?.['q'] ?? '').slice(0, 100);
      return json(200, { version: SHOPIFY_TAXONOMY_VERSION, categories: searchShopifyCategories(q, 25) });
    }

    return error(404, 'NOT_FOUND', 'Unknown route.');
  } catch (e) {
    if (e instanceof ExportRequestError) return error(e.status, e.code, e.message);
    if (e instanceof ExportNeedsFixingError) {
      return error(409, 'NEEDS_FIXING', e.message, { check: e.check });
    }
    console.error('Store export failed', { route, error: e instanceof Error ? e.message : String(e) });
    return error(500, 'INTERNAL_ERROR', 'The export could not be made. Please try again.');
  }
}
