/**
 * Reads products for an export (always inside the signed-in seller's own
 * partition, PK TENANT#<tenantId>) and remembers per-store choices on the
 * product: the chosen category per store and the Shopify URL handle.
 *
 *   products table   PK TENANT#<t>  SK PRODUCT#<id>               the product
 *                                   SK PRODUCT#<id>#ENRICHMENT    suggestions
 *   inventory table  PK TENANT#<t>  SK SKU#<sku>#WH#<warehouse>   stock
 */

import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import {
  BatchGetCommand,
  DynamoDBDocumentClient,
  QueryCommand,
  UpdateCommand,
  type BatchGetCommandOutput,
} from '@aws-sdk/lib-dynamodb';
import type { CanonicalProduct } from '@merch-os/types';
import type { ExportChannel } from '../channels/types.js';
import type { EnrichmentRecordLike } from './prepare.js';

export interface StoredProduct {
  product: CanonicalProduct;
  enrichment: EnrichmentRecordLike | null;
}

/** The store-facing data port (tests use an in-memory fake). */
export interface ProductStorePort {
  loadProducts(tenantId: string, productIds: readonly string[]): Promise<Map<string, StoredProduct>>;
  loadStock(tenantId: string): Promise<Record<string, number>>;
  saveChannelCategory(tenantId: string, productId: string, channel: ExportChannel, value: string | null): Promise<void>;
  recordExport(tenantId: string, productId: string, channel: ExportChannel, entry: { date: string; version: string; shopifyHandle?: string }): Promise<void>;
}

const BATCH = 100;

function strip(item: Record<string, unknown>): Record<string, unknown> {
  const { PK: _pk, SK: _sk, GSI1PK: _g1, GSI1SK: _g2, ...rest } = item;
  return rest;
}

export class DynamoProductStore implements ProductStorePort {
  private readonly doc: DynamoDBDocumentClient;

  constructor(
    private readonly productsTable: string,
    private readonly inventoryTable: string,
    doc?: DynamoDBDocumentClient
  ) {
    this.doc =
      doc ?? DynamoDBDocumentClient.from(new DynamoDBClient({}), { marshallOptions: { removeUndefinedValues: true } });
  }

  async loadProducts(tenantId: string, productIds: readonly string[]): Promise<Map<string, StoredProduct>> {
    const pk = `TENANT#${tenantId}`;
    const keys = [...new Set(productIds)].flatMap((id) => [
      { PK: pk, SK: `PRODUCT#${id}` },
      { PK: pk, SK: `PRODUCT#${id}#ENRICHMENT` },
    ]);
    const items: Record<string, unknown>[] = [];
    for (let i = 0; i < keys.length; i += BATCH) {
      let request: Record<string, unknown>[] | undefined = keys.slice(i, i + BATCH);
      for (let attempt = 0; request && request.length > 0 && attempt < 6; attempt++) {
        if (attempt > 0) await new Promise((r) => setTimeout(r, 50 * 2 ** attempt));
        const res: BatchGetCommandOutput = await this.doc.send(
          new BatchGetCommand({ RequestItems: { [this.productsTable]: { Keys: request } } })
        );
        items.push(...(res.Responses?.[this.productsTable] ?? []));
        request = res.UnprocessedKeys?.[this.productsTable]?.Keys as Record<string, unknown>[] | undefined;
      }
      if (request && request.length > 0) throw new Error('Could not load all products (database busy). Try again.');
    }

    const out = new Map<string, StoredProduct>();
    const enrichments = new Map<string, EnrichmentRecordLike>();
    for (const item of items) {
      // Defence in depth: only ever this tenant's partition.
      if (item['PK'] !== pk) continue;
      const sk = String(item['SK']);
      if (sk.endsWith('#ENRICHMENT')) {
        enrichments.set(sk.slice('PRODUCT#'.length, -'#ENRICHMENT'.length), strip(item) as EnrichmentRecordLike);
      } else {
        const product = strip(item) as unknown as CanonicalProduct;
        if (product.tenantId === tenantId) out.set(product.productId, { product, enrichment: null });
      }
    }
    for (const [id, e] of enrichments) {
      const p = out.get(id);
      if (p) p.enrichment = e;
    }
    return out;
  }

  async loadStock(tenantId: string): Promise<Record<string, number>> {
    const stock: Record<string, number> = {};
    let start: Record<string, unknown> | undefined;
    do {
      const res = await this.doc.send(
        new QueryCommand({
          TableName: this.inventoryTable,
          KeyConditionExpression: 'PK = :pk AND begins_with(SK, :sku)',
          ExpressionAttributeValues: { ':pk': `TENANT#${tenantId}`, ':sku': 'SKU#' },
          ProjectionExpression: 'sku, available, onHand, reserved',
          ...(start ? { ExclusiveStartKey: start } : {}),
        })
      );
      for (const i of res.Items ?? []) {
        const sku = typeof i['sku'] === 'string' ? i['sku'] : null;
        if (!sku) continue;
        const available =
          typeof i['available'] === 'number'
            ? i['available']
            : Number(i['onHand'] ?? 0) - Number(i['reserved'] ?? 0);
        stock[sku] = (stock[sku] ?? 0) + (Number.isFinite(available) ? available : 0);
      }
      start = res.LastEvaluatedKey as Record<string, unknown> | undefined;
    } while (start);
    return stock;
  }

  async saveChannelCategory(tenantId: string, productId: string, channel: ExportChannel, value: string | null): Promise<void> {
    const common = {
      TableName: this.productsTable,
      Key: { PK: `TENANT#${tenantId}`, SK: `PRODUCT#${productId}` },
      ConditionExpression: 'attribute_exists(PK)',
    };
    await this.doc.send(
      new UpdateCommand(
        value
          ? {
              ...common,
              UpdateExpression: 'SET platformSpecific.categoryMappings.#ch = :v',
              ExpressionAttributeNames: { '#ch': channel },
              ExpressionAttributeValues: { ':v': value },
            }
          : {
              ...common,
              UpdateExpression: 'REMOVE platformSpecific.categoryMappings.#ch',
              ExpressionAttributeNames: { '#ch': channel },
            }
      )
    );
  }

  async recordExport(
    tenantId: string,
    productId: string,
    channel: ExportChannel,
    entry: { date: string; version: string; shopifyHandle?: string }
  ): Promise<void> {
    const names: Record<string, string> = { '#ch': channel };
    const values: Record<string, unknown> = {
      ':h': { lastExportDate: entry.date, lastExportVersion: entry.version, exportStatus: 'success' },
    };
    let set = 'platformSpecific.exportHistory.#ch = :h';
    if (entry.shopifyHandle) {
      set += ', platformSpecific.platformIdentifiers.#shop = :handle';
      names['#shop'] = 'shopify';
      values[':handle'] = entry.shopifyHandle;
    }
    await this.doc.send(
      new UpdateCommand({
        TableName: this.productsTable,
        Key: { PK: `TENANT#${tenantId}`, SK: `PRODUCT#${productId}` },
        UpdateExpression: `SET ${set}`,
        ConditionExpression: 'attribute_exists(PK)',
        ExpressionAttributeNames: names,
        ExpressionAttributeValues: values,
      })
    );
  }
}
