/**
 * TransactionRepository — read-only accessor for the immutable inventory
 * transaction ledger.
 *
 * The ledger is append-only. Appends happen EXCLUSIVELY through
 * InventoryRepository.putWithTransaction, which writes the ledger entry in the
 * same DynamoDB TransactWriteItems as the inventory record change — guaranteeing
 * a ledger entry can never exist without its corresponding inventory mutation
 * (and vice versa).
 *
 * This repository therefore intentionally exposes NO create/update/delete
 * methods for ledger records — only history reads. Any future append must go
 * through the atomic path, not here.
 *
 * Transactions table keys:
 *   PK = TENANT#<tenantId>, SK = TXN#<timestamp>#<txnId>
 *   GSI1PK = TENANT#<tenantId>#SKU#<sku>, GSI1SK = <timestamp>#<txnId>
 */

import {
  DynamoDBClient,
  DynamoDBClientConfig,
} from '@aws-sdk/client-dynamodb';
import {
  DynamoDBDocumentClient,
  QueryCommand,
} from '@aws-sdk/lib-dynamodb';
import type { InventoryTransaction } from '../../shared/types/inventory.types';
import { INVENTORY_TRANSACTIONS_TABLE } from '../../shared/utils/dynamo-client';
import { InventoryPersistenceError } from './errors';
import type { ListTransactionsOptions, PaginatedTransactions } from './types';

const DEFAULT_LIMIT = 50;
const MAX_LIMIT = 100;

function txnGsi1PK(tenantId: string, sku: string): string {
  return `TENANT#${tenantId}#SKU#${sku}`;
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

function fromTransactionItem(item: Record<string, unknown>): InventoryTransaction {
  const { PK, SK, GSI1PK, GSI1SK, ...rest } = item;
  void PK;
  void SK;
  void GSI1PK;
  void GSI1SK;
  return rest as unknown as InventoryTransaction;
}

export class TransactionRepository {
  private readonly docClient: DynamoDBDocumentClient;
  private readonly transactionsTable: string;

  constructor(config?: DynamoDBClientConfig) {
    const client = new DynamoDBClient(config ?? {});
    this.docClient = DynamoDBDocumentClient.from(client, {
      marshallOptions: { removeUndefinedValues: true },
    });
    this.transactionsTable = INVENTORY_TRANSACTIONS_TABLE;
  }

  /** Inject a pre-configured DynamoDBDocumentClient (used for testing). */
  static fromDocClient(docClient: DynamoDBDocumentClient): TransactionRepository {
    const repo = Object.create(TransactionRepository.prototype) as TransactionRepository;
    Object.defineProperty(repo, 'docClient', { value: docClient, writable: false });
    Object.defineProperty(repo, 'transactionsTable', {
      value: INVENTORY_TRANSACTIONS_TABLE,
      writable: false,
    });
    return repo;
  }

  /**
   * Query a SKU's immutable ledger history for a tenant via GSI1 (newest
   * first), paginated. Tenant-scoped: GSI1PK embeds the tenantId, so results
   * never span tenants.
   */
  async listBySku(
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
