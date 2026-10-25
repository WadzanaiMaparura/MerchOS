/**
 * InventoryRepository — persistence boundary for inventory records and the
 * immutable transaction ledger.
 *
 * Responsibilities (persistence ONLY — no business rules):
 *  - get / list / query inventory records
 *  - commit an inventory record change together with its ledger entry
 *    atomically via DynamoDB TransactWriteItems
 *  - detect concurrent/stale updates via conditional writes
 *  - query a SKU's immutable transaction history (read-only)
 *
 * Business rules (non-negative invariant, SKU validation, absolute-vs-delta
 * math) live in the Inventory Service, not here. tenantId is always supplied
 * explicitly by the service — never read from a request body.
 *
 * Keys (see services/shared/utils/dynamo-client.ts helpers):
 *   Inventory table:
 *     PK  = TENANT#<tenantId>
 *     SK  = SKU#<sku>#WH#<warehouseId>
 *     GSI1PK = SKU#<sku>, GSI1SK = TENANT#<tenantId>
 *   Transactions table:
 *     PK  = TENANT#<tenantId>
 *     SK  = TXN#<timestamp>#<txnId>
 *     GSI1PK = TENANT#<tenantId>#SKU#<sku>, GSI1SK = <timestamp>#<txnId>
 */

import {
  DynamoDBClient,
  DynamoDBClientConfig,
} from '@aws-sdk/client-dynamodb';
import {
  DynamoDBDocumentClient,
  GetCommand,
  QueryCommand,
  TransactWriteCommand,
} from '@aws-sdk/lib-dynamodb';
import type { InventoryRecord, InventoryTransaction } from '../../shared/types/inventory.types';
import {
  INVENTORY_TABLE,
  INVENTORY_TRANSACTIONS_TABLE,
  tenantPK,
  inventorySK,
  transactionSK,
} from '../../shared/utils/dynamo-client';
import { InventoryConcurrencyError, InventoryPersistenceError } from './errors';
import type {
  ListInventoryOptions,
  PaginatedInventory,
  ListTransactionsOptions,
  PaginatedTransactions,
  InventoryWriteCondition,
} from './types';

// ---------------------------------------------------------------------------
// Key helpers (local — mirrors ProductRepository's local GSI helpers)
// ---------------------------------------------------------------------------

/** Inventory GSI1 partition key: all warehouses/tenants for a SKU. */
function inventoryGsi1PK(sku: string): string {
  return `SKU#${sku}`;
}

/** Inventory GSI1 sort key. */
function inventoryGsi1SK(tenantId: string): string {
  return tenantPK(tenantId);
}

/** Transactions GSI1 partition key: a tenant's ledger for a single SKU. */
function txnGsi1PK(tenantId: string, sku: string): string {
  return `TENANT#${tenantId}#SKU#${sku}`;
}

/** Transactions GSI1 sort key: time-sortable within the SKU partition. */
function txnGsi1SK(timestamp: string, txnId: string): string {
  return `${timestamp}#${txnId}`;
}

const DEFAULT_LIMIT = 50;
const MAX_LIMIT = 100;

const INVENTORY_SK_PREFIX = 'SKU#';

// ---------------------------------------------------------------------------
// Item mapping
// ---------------------------------------------------------------------------

interface InventoryItem extends Record<string, unknown> {
  PK: string;
  SK: string;
  GSI1PK: string;
  GSI1SK: string;
}

interface TransactionItem extends Record<string, unknown> {
  PK: string;
  SK: string;
  GSI1PK: string;
  GSI1SK: string;
}

function toInventoryItem(record: InventoryRecord): InventoryItem {
  return {
    ...record,
    PK: tenantPK(record.tenantId),
    SK: inventorySK(record.sku, record.warehouseId),
    GSI1PK: inventoryGsi1PK(record.sku),
    GSI1SK: inventoryGsi1SK(record.tenantId),
  };
}

function fromInventoryItem(item: Record<string, unknown>): InventoryRecord {
  const { PK, SK, GSI1PK, GSI1SK, ...rest } = item;
  void PK;
  void SK;
  void GSI1PK;
  void GSI1SK;
  return rest as unknown as InventoryRecord;
}

function toTransactionItem(txn: InventoryTransaction): TransactionItem {
  return {
    ...txn,
    PK: tenantPK(txn.tenantId),
    SK: transactionSK(txn.timestamp, txn.txnId),
    GSI1PK: txnGsi1PK(txn.tenantId, txn.sku),
    GSI1SK: txnGsi1SK(txn.timestamp, txn.txnId),
  };
}

function fromTransactionItem(item: Record<string, unknown>): InventoryTransaction {
  const { PK, SK, GSI1PK, GSI1SK, ...rest } = item;
  void PK;
  void SK;
  void GSI1PK;
  void GSI1SK;
  return rest as unknown as InventoryTransaction;
}

function clampLimit(limit?: number): number {
  if (limit === undefined) {
    return DEFAULT_LIMIT;
  }
  return Math.min(limit, MAX_LIMIT);
}

function encodeToken(key: Record<string, unknown>): string {
  return Buffer.from(JSON.stringify(key)).toString('base64');
}

function decodeToken(token: string): Record<string, unknown> {
  try {
    return JSON.parse(Buffer.from(token, 'base64').toString('utf-8'));
  } catch {
    throw new InventoryPersistenceError('Invalid pagination token');
  }
}

function isConditionalFailure(error: unknown): boolean {
  if (!(error instanceof Error)) {
    return false;
  }
  if (error.name === 'ConditionalCheckFailedException') {
    return true;
  }
  // TransactWriteItems surfaces condition failures as TransactionCanceledException
  // with CancellationReasons[].Code === 'ConditionalCheckFailed'.
  if (error.name === 'TransactionCanceledException') {
    const reasons = (error as unknown as {
      CancellationReasons?: Array<{ Code?: string }>;
    }).CancellationReasons;
    if (Array.isArray(reasons)) {
      return reasons.some((r) => r?.Code === 'ConditionalCheckFailed');
    }
    // Some SDK versions embed the code in the message.
    return /ConditionalCheckFailed/.test(error.message);
  }
  return false;
}

// ---------------------------------------------------------------------------
// Repository
// ---------------------------------------------------------------------------

export class InventoryRepository {
  private readonly docClient: DynamoDBDocumentClient;
  private readonly inventoryTable: string;
  private readonly transactionsTable: string;

  constructor(config?: DynamoDBClientConfig) {
    const client = new DynamoDBClient(config ?? {});
    this.docClient = DynamoDBDocumentClient.from(client, {
      marshallOptions: { removeUndefinedValues: true },
    });
    this.inventoryTable = INVENTORY_TABLE;
    this.transactionsTable = INVENTORY_TRANSACTIONS_TABLE;
  }

  /** Inject a pre-configured DynamoDBDocumentClient (used for testing). */
  static fromDocClient(docClient: DynamoDBDocumentClient): InventoryRepository {
    const repo = Object.create(InventoryRepository.prototype) as InventoryRepository;
    Object.defineProperty(repo, 'docClient', { value: docClient, writable: false });
    Object.defineProperty(repo, 'inventoryTable', { value: INVENTORY_TABLE, writable: false });
    Object.defineProperty(repo, 'transactionsTable', {
      value: INVENTORY_TRANSACTIONS_TABLE,
      writable: false,
    });
    return repo;
  }

  // -------------------------------------------------------------------------
  // Reads
  // -------------------------------------------------------------------------

  /**
   * Get a single inventory record for a SKU in a specific warehouse.
   *
   * @param consistentRead - use strongly-consistent read (required on the
   *   update path so the service reads the latest state before writing).
   */
  async get(
    tenantId: string,
    sku: string,
    warehouseId: string,
    consistentRead = false
  ): Promise<InventoryRecord | null> {
    try {
      const result = await this.docClient.send(
        new GetCommand({
          TableName: this.inventoryTable,
          Key: {
            PK: tenantPK(tenantId),
            SK: inventorySK(sku, warehouseId),
          },
          ConsistentRead: consistentRead,
        })
      );
      if (!result.Item) {
        return null;
      }
      return fromInventoryItem(result.Item);
    } catch (error) {
      throw new InventoryPersistenceError(
        `Failed to get inventory record: sku=${sku}, warehouseId=${warehouseId}`,
        error instanceof Error ? error : undefined
      );
    }
  }

  /** List all inventory records for a tenant (eventually consistent, paginated). */
  async listByTenant(
    tenantId: string,
    options?: ListInventoryOptions
  ): Promise<PaginatedInventory> {
    const limit = clampLimit(options?.limit);

    let exclusiveStartKey: Record<string, unknown> | undefined;
    if (options?.nextToken) {
      exclusiveStartKey = decodeToken(options.nextToken);
    }

    try {
      const result = await this.docClient.send(
        new QueryCommand({
          TableName: this.inventoryTable,
          KeyConditionExpression: 'PK = :pk AND begins_with(SK, :skPrefix)',
          ExpressionAttributeValues: {
            ':pk': tenantPK(tenantId),
            ':skPrefix': INVENTORY_SK_PREFIX,
          },
          Limit: limit,
          ...(exclusiveStartKey ? { ExclusiveStartKey: exclusiveStartKey } : {}),
        })
      );

      const items = (result.Items ?? []).map(fromInventoryItem);
      if (result.LastEvaluatedKey) {
        return { items, nextToken: encodeToken(result.LastEvaluatedKey) };
      }
      return { items };
    } catch (error) {
      if (error instanceof InventoryPersistenceError) {
        throw error;
      }
      throw new InventoryPersistenceError(
        `Failed to list inventory for tenant: ${tenantId}`,
        error instanceof Error ? error : undefined
      );
    }
  }

  /**
   * Query all warehouse records for a SKU within a tenant via GSI1.
   *
   * GSI1PK = SKU#<sku> is further filtered to the caller's tenant
   * (GSI1SK = TENANT#<tenantId>) so results never span tenants.
   */
  async queryBySku(tenantId: string, sku: string): Promise<InventoryRecord[]> {
    try {
      const result = await this.docClient.send(
        new QueryCommand({
          TableName: this.inventoryTable,
          IndexName: 'GSI1',
          KeyConditionExpression: 'GSI1PK = :gsi1pk AND GSI1SK = :gsi1sk',
          ExpressionAttributeValues: {
            ':gsi1pk': inventoryGsi1PK(sku),
            ':gsi1sk': inventoryGsi1SK(tenantId),
          },
        })
      );
      return (result.Items ?? []).map(fromInventoryItem);
    } catch (error) {
      throw new InventoryPersistenceError(
        `Failed to query inventory by SKU: ${sku}`,
        error instanceof Error ? error : undefined
      );
    }
  }

  // -------------------------------------------------------------------------
  // Atomic write (inventory record + ledger entry)
  // -------------------------------------------------------------------------

  /**
   * Commit an inventory record and its ledger entry atomically.
   *
   * Both items succeed or neither does (DynamoDB TransactWriteItems). This is
   * the ONLY mutation entry point for inventory, which guarantees:
   *   - no inventory change without a corresponding ledger entry, and
   *   - no ledger entry without the corresponding inventory change.
   *
   * Concurrency: the inventory Put carries a ConditionExpression derived from
   * `condition`:
   *   - create  (no expectedUpdatedAt): `attribute_not_exists(PK)` — fails if a
   *     record already exists.
   *   - update  (expectedUpdatedAt set): asserts the stored `updatedAt` equals
   *     the value the service read — fails if another writer changed it.
   * A conditional failure maps to InventoryConcurrencyError so the service can
   * surface a deterministic 409 instead of silently overwriting.
   *
   * The transaction ledger Put is itself guarded by
   * `attribute_not_exists(SK)` to keep the ledger strictly append-only (a
   * duplicate txnId can never overwrite an existing entry).
   */
  async putWithTransaction(
    record: InventoryRecord,
    transaction: InventoryTransaction,
    condition: InventoryWriteCondition
  ): Promise<InventoryRecord> {
    const inventoryItem = toInventoryItem(record);
    const transactionItem = toTransactionItem(transaction);

    const isCreate = condition.expectedUpdatedAt === undefined;

    const inventoryPut = isCreate
      ? {
          TableName: this.inventoryTable,
          Item: inventoryItem,
          ConditionExpression: 'attribute_not_exists(PK)',
        }
      : {
          TableName: this.inventoryTable,
          Item: inventoryItem,
          ConditionExpression: 'attribute_exists(PK) AND updatedAt = :expectedUpdatedAt',
          ExpressionAttributeValues: {
            ':expectedUpdatedAt': condition.expectedUpdatedAt,
          },
        };

    try {
      await this.docClient.send(
        new TransactWriteCommand({
          TransactItems: [
            { Put: inventoryPut },
            {
              Put: {
                TableName: this.transactionsTable,
                Item: transactionItem,
                // Append-only guard: never overwrite an existing ledger entry.
                ConditionExpression: 'attribute_not_exists(SK)',
              },
            },
          ],
        })
      );
      return record;
    } catch (error) {
      if (isConditionalFailure(error)) {
        throw new InventoryConcurrencyError(
          record.tenantId,
          record.sku,
          record.warehouseId
        );
      }
      throw new InventoryPersistenceError(
        `Failed to commit inventory + ledger transaction: sku=${record.sku}, warehouseId=${record.warehouseId}`,
        error instanceof Error ? error : undefined
      );
    }
  }

  // -------------------------------------------------------------------------
  // Ledger history (read-only; ledger is immutable)
  // -------------------------------------------------------------------------

  /**
   * Query a SKU's transaction ledger history for a tenant via GSI1
   * (newest first), paginated. There are intentionally no update/delete
   * methods for transactions — the ledger is append-only.
   */
  async listTransactionsBySku(
    tenantId: string,
    sku: string,
    options?: ListTransactionsOptions
  ): Promise<PaginatedTransactions> {
    const limit = clampLimit(options?.limit);

    let exclusiveStartKey: Record<string, unknown> | undefined;
    if (options?.nextToken) {
      exclusiveStartKey = decodeToken(options.nextToken);
    }

    try {
      const result = await this.docClient.send(
        new QueryCommand({
          TableName: this.transactionsTable,
          IndexName: 'GSI1',
          KeyConditionExpression: 'GSI1PK = :gsi1pk',
          ExpressionAttributeValues: {
            ':gsi1pk': txnGsi1PK(tenantId, sku),
          },
          ScanIndexForward: false, // newest first
          Limit: limit,
          ...(exclusiveStartKey ? { ExclusiveStartKey: exclusiveStartKey } : {}),
        })
      );

      const items = (result.Items ?? []).map(fromTransactionItem);
      if (result.LastEvaluatedKey) {
        return { items, nextToken: encodeToken(result.LastEvaluatedKey) };
      }
      return { items };
    } catch (error) {
      if (error instanceof InventoryPersistenceError) {
        throw error;
      }
      throw new InventoryPersistenceError(
        `Failed to list transactions for SKU: ${sku}`,
        error instanceof Error ? error : undefined
      );
    }
  }
}
