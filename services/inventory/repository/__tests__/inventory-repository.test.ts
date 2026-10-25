/**
 * Unit tests for InventoryRepository and TransactionRepository.
 *
 * Uses aws-sdk-client-mock to mock DynamoDBDocumentClient commands, mirroring
 * the ProductRepository test conventions.
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { mockClient } from 'aws-sdk-client-mock';
import {
  DynamoDBDocumentClient,
  GetCommand,
  QueryCommand,
  TransactWriteCommand,
} from '@aws-sdk/lib-dynamodb';
import type { InventoryRecord, InventoryTransaction } from '../../../shared/types/inventory.types';
import { InventoryRepository } from '../inventory-repository';
import { TransactionRepository } from '../transaction-repository';
import { InventoryConcurrencyError, InventoryPersistenceError } from '../errors';

const INVENTORY_TABLE = 'merch-os-inventory';
const TRANSACTIONS_TABLE = 'merch-os-inventory-transactions';

const ddbMock = mockClient(DynamoDBDocumentClient);

function createRepo(): InventoryRepository {
  return InventoryRepository.fromDocClient(ddbMock as unknown as DynamoDBDocumentClient);
}

function createTxnRepo(): TransactionRepository {
  return TransactionRepository.fromDocClient(ddbMock as unknown as DynamoDBDocumentClient);
}

function makeRecord(overrides?: Partial<InventoryRecord>): InventoryRecord {
  return {
    tenantId: 'tenant-abc',
    sku: 'SKU-123',
    warehouseId: 'WH-MAIN',
    onHand: 10,
    reserved: 0,
    available: 10,
    updatedAt: '2024-01-01T00:00:00.000Z',
    ...overrides,
  };
}

function makeTxn(overrides?: Partial<InventoryTransaction>): InventoryTransaction {
  return {
    tenantId: 'tenant-abc',
    txnId: 'txn-001',
    sku: 'SKU-123',
    warehouseId: 'WH-MAIN',
    actor: 'user-789',
    source: 'manual',
    deltaQty: 5,
    previousQty: 5,
    newQty: 10,
    timestamp: '2024-01-01T00:00:00.000Z',
    ...overrides,
  };
}

function makeInventoryItem(record: InventoryRecord): Record<string, unknown> {
  return {
    ...record,
    PK: `TENANT#${record.tenantId}`,
    SK: `SKU#${record.sku}#WH#${record.warehouseId}`,
    GSI1PK: `SKU#${record.sku}`,
    GSI1SK: `TENANT#${record.tenantId}`,
  };
}

function makeTransactionItem(txn: InventoryTransaction): Record<string, unknown> {
  return {
    ...txn,
    PK: `TENANT#${txn.tenantId}`,
    SK: `TXN#${txn.timestamp}#${txn.txnId}`,
    GSI1PK: `TENANT#${txn.tenantId}#SKU#${txn.sku}`,
    GSI1SK: `${txn.timestamp}#${txn.txnId}`,
  };
}

describe('InventoryRepository', () => {
  beforeEach(() => {
    ddbMock.reset();
  });

  // -------------------------------------------------------------------------
  // Key construction (via the items the repository writes)
  // -------------------------------------------------------------------------

  describe('key construction', () => {
    it('builds tenant/warehouse keys and GSI keys for the inventory item', async () => {
      ddbMock.on(TransactWriteCommand).resolves({});
      const repo = createRepo();

      await repo.putWithTransaction(makeRecord(), makeTxn(), {}); // create

      const input = ddbMock.commandCalls(TransactWriteCommand)[0]!.args[0].input;
      const invItem = input.TransactItems![0]!.Put!.Item!;
      expect(invItem['PK']).toBe('TENANT#tenant-abc');
      expect(invItem['SK']).toBe('SKU#SKU-123#WH#WH-MAIN'); // WH, not WAREHOUSE
      expect(invItem['GSI1PK']).toBe('SKU#SKU-123');
      expect(invItem['GSI1SK']).toBe('TENANT#tenant-abc');
    });

    it('builds transaction key TXN#<timestamp>#<txnId> and SKU-scoped GSI key', async () => {
      ddbMock.on(TransactWriteCommand).resolves({});
      const repo = createRepo();

      await repo.putWithTransaction(makeRecord(), makeTxn(), {});

      const input = ddbMock.commandCalls(TransactWriteCommand)[0]!.args[0].input;
      const txnItem = input.TransactItems![1]!.Put!.Item!;
      expect(txnItem['PK']).toBe('TENANT#tenant-abc');
      expect(txnItem['SK']).toBe('TXN#2024-01-01T00:00:00.000Z#txn-001');
      expect(txnItem['GSI1PK']).toBe('TENANT#tenant-abc#SKU#SKU-123');
      expect(txnItem['GSI1SK']).toBe('2024-01-01T00:00:00.000Z#txn-001');
    });
  });

  // -------------------------------------------------------------------------
  // get
  // -------------------------------------------------------------------------

  describe('get', () => {
    it('returns a record and strips DynamoDB keys', async () => {
      const record = makeRecord();
      ddbMock.on(GetCommand).resolves({ Item: makeInventoryItem(record) });

      const repo = createRepo();
      const result = await repo.get('tenant-abc', 'SKU-123', 'WH-MAIN');

      expect(result).not.toBeNull();
      expect(result!.sku).toBe('SKU-123');
      expect((result as Record<string, unknown>)['PK']).toBeUndefined();
      expect((result as Record<string, unknown>)['GSI1PK']).toBeUndefined();

      const input = ddbMock.commandCalls(GetCommand)[0]!.args[0].input;
      expect(input.Key).toEqual({
        PK: 'TENANT#tenant-abc',
        SK: 'SKU#SKU-123#WH#WH-MAIN',
      });
      expect(input.TableName).toBe(INVENTORY_TABLE);
      expect(input.ConsistentRead).toBe(false);
    });

    it('returns null when the record does not exist', async () => {
      ddbMock.on(GetCommand).resolves({ Item: undefined });
      const repo = createRepo();
      const result = await repo.get('tenant-abc', 'SKU-404', 'WH-MAIN');
      expect(result).toBeNull();
    });

    it('uses a strongly-consistent read when requested (update path)', async () => {
      ddbMock.on(GetCommand).resolves({ Item: makeInventoryItem(makeRecord()) });
      const repo = createRepo();
      await repo.get('tenant-abc', 'SKU-123', 'WH-MAIN', true);
      const input = ddbMock.commandCalls(GetCommand)[0]!.args[0].input;
      expect(input.ConsistentRead).toBe(true);
    });
  });

  // -------------------------------------------------------------------------
  // listByTenant
  // -------------------------------------------------------------------------

  describe('listByTenant', () => {
    it('queries the tenant partition with the SKU# prefix (single page)', async () => {
      const records = [makeRecord(), makeRecord({ warehouseId: 'WH-2' })];
      ddbMock.on(QueryCommand).resolves({
        Items: records.map(makeInventoryItem),
        LastEvaluatedKey: undefined,
      });

      const repo = createRepo();
      const result = await repo.listByTenant('tenant-abc');

      expect(result.items).toHaveLength(2);
      expect(result.nextToken).toBeUndefined();

      const input = ddbMock.commandCalls(QueryCommand)[0]!.args[0].input;
      expect(input.KeyConditionExpression).toBe('PK = :pk AND begins_with(SK, :skPrefix)');
      expect(input.ExpressionAttributeValues).toEqual({
        ':pk': 'TENANT#tenant-abc',
        ':skPrefix': 'SKU#',
      });
      expect(input.Limit).toBe(50); // default
    });

    it('encodes and passes pagination tokens', async () => {
      const lastKey = { PK: 'TENANT#tenant-abc', SK: 'SKU#SKU-9#WH#WH-1' };
      ddbMock.on(QueryCommand).resolves({
        Items: [makeInventoryItem(makeRecord())],
        LastEvaluatedKey: { PK: 'TENANT#tenant-abc', SK: 'SKU#SKU-10#WH#WH-1' },
      });

      const repo = createRepo();
      const token = Buffer.from(JSON.stringify(lastKey)).toString('base64');
      const result = await repo.listByTenant('tenant-abc', { nextToken: token, limit: 10 });

      expect(result.nextToken).toBeDefined();
      const decoded = JSON.parse(Buffer.from(result.nextToken!, 'base64').toString('utf-8'));
      expect(decoded).toEqual({ PK: 'TENANT#tenant-abc', SK: 'SKU#SKU-10#WH#WH-1' });

      const input = ddbMock.commandCalls(QueryCommand)[0]!.args[0].input;
      expect(input.ExclusiveStartKey).toEqual(lastKey);
      expect(input.Limit).toBe(10);
    });

    it('caps limit at 100', async () => {
      ddbMock.on(QueryCommand).resolves({ Items: [], LastEvaluatedKey: undefined });
      const repo = createRepo();
      await repo.listByTenant('tenant-abc', { limit: 500 });
      expect(ddbMock.commandCalls(QueryCommand)[0]!.args[0].input.Limit).toBe(100);
    });

    it('rejects a malformed pagination token', async () => {
      const repo = createRepo();
      await expect(
        repo.listByTenant('tenant-abc', { nextToken: 'not-base64-json' })
      ).rejects.toBeInstanceOf(InventoryPersistenceError);
    });
  });

  // -------------------------------------------------------------------------
  // queryBySku (all warehouses for a SKU via GSI1, tenant-scoped)
  // -------------------------------------------------------------------------

  describe('queryBySku', () => {
    it('queries GSI1 scoped to the tenant', async () => {
      const records = [makeRecord(), makeRecord({ warehouseId: 'WH-2' })];
      ddbMock.on(QueryCommand).resolves({ Items: records.map(makeInventoryItem) });

      const repo = createRepo();
      const result = await repo.queryBySku('tenant-abc', 'SKU-123');

      expect(result).toHaveLength(2);
      const input = ddbMock.commandCalls(QueryCommand)[0]!.args[0].input;
      expect(input.IndexName).toBe('GSI1');
      expect(input.KeyConditionExpression).toBe('GSI1PK = :gsi1pk AND GSI1SK = :gsi1sk');
      expect(input.ExpressionAttributeValues).toEqual({
        ':gsi1pk': 'SKU#SKU-123',
        ':gsi1sk': 'TENANT#tenant-abc',
      });
    });

    it('returns an empty array when the SKU has no records', async () => {
      ddbMock.on(QueryCommand).resolves({ Items: [] });
      const repo = createRepo();
      expect(await repo.queryBySku('tenant-abc', 'SKU-none')).toEqual([]);
    });
  });

  // -------------------------------------------------------------------------
  // putWithTransaction — atomic write construction + concurrency
  // -------------------------------------------------------------------------

  describe('putWithTransaction (atomic inventory + ledger)', () => {
    it('issues a single TransactWriteItems with BOTH the record and the ledger Put', async () => {
      ddbMock.on(TransactWriteCommand).resolves({});
      const repo = createRepo();

      await repo.putWithTransaction(makeRecord(), makeTxn(), {});

      const calls = ddbMock.commandCalls(TransactWriteCommand);
      expect(calls).toHaveLength(1);
      const items = calls[0]!.args[0].input.TransactItems!;
      expect(items).toHaveLength(2);
      expect(items[0]!.Put!.TableName).toBe(INVENTORY_TABLE);
      expect(items[1]!.Put!.TableName).toBe(TRANSACTIONS_TABLE);
    });

    it('on CREATE asserts attribute_not_exists(PK) on the inventory item', async () => {
      ddbMock.on(TransactWriteCommand).resolves({});
      const repo = createRepo();

      await repo.putWithTransaction(makeRecord(), makeTxn(), {}); // no expectedUpdatedAt => create

      const items = ddbMock.commandCalls(TransactWriteCommand)[0]!.args[0].input.TransactItems!;
      expect(items[0]!.Put!.ConditionExpression).toBe('attribute_not_exists(PK)');
    });

    it('on UPDATE asserts the stored updatedAt still matches (optimistic concurrency)', async () => {
      ddbMock.on(TransactWriteCommand).resolves({});
      const repo = createRepo();

      await repo.putWithTransaction(
        makeRecord({ onHand: 15, available: 15, updatedAt: '2024-01-02T00:00:00.000Z' }),
        makeTxn({ previousQty: 10, newQty: 15, deltaQty: 5 }),
        { expectedUpdatedAt: '2024-01-01T00:00:00.000Z' }
      );

      const invPut = ddbMock.commandCalls(TransactWriteCommand)[0]!.args[0].input.TransactItems![0]!.Put!;
      expect(invPut.ConditionExpression).toBe('attribute_exists(PK) AND updatedAt = :expectedUpdatedAt');
      expect(invPut.ExpressionAttributeValues).toEqual({
        ':expectedUpdatedAt': '2024-01-01T00:00:00.000Z',
      });
    });

    it('guards the ledger Put with attribute_not_exists(SK) (append-only)', async () => {
      ddbMock.on(TransactWriteCommand).resolves({});
      const repo = createRepo();

      await repo.putWithTransaction(makeRecord(), makeTxn(), {});

      const txnPut = ddbMock.commandCalls(TransactWriteCommand)[0]!.args[0].input.TransactItems![1]!.Put!;
      expect(txnPut.ConditionExpression).toBe('attribute_not_exists(SK)');
    });

    it('maps a conditional failure to InventoryConcurrencyError (no silent overwrite)', async () => {
      const err = new Error('Transaction cancelled');
      err.name = 'TransactionCanceledException';
      (err as unknown as { CancellationReasons: Array<{ Code: string }> }).CancellationReasons = [
        { Code: 'ConditionalCheckFailed' },
        { Code: 'None' },
      ];
      ddbMock.on(TransactWriteCommand).rejects(err);

      const repo = createRepo();
      await expect(
        repo.putWithTransaction(makeRecord(), makeTxn(), { expectedUpdatedAt: '2024-01-01T00:00:00.000Z' })
      ).rejects.toBeInstanceOf(InventoryConcurrencyError);
      await expect(
        repo.putWithTransaction(makeRecord(), makeTxn(), { expectedUpdatedAt: '2024-01-01T00:00:00.000Z' })
      ).rejects.toMatchObject({ code: 'INVENTORY_CONCURRENT_UPDATE' });
    });

    it('maps other DynamoDB failures to InventoryPersistenceError', async () => {
      ddbMock.on(TransactWriteCommand).rejects(new Error('ProvisionedThroughputExceeded'));
      const repo = createRepo();
      await expect(
        repo.putWithTransaction(makeRecord(), makeTxn(), {})
      ).rejects.toBeInstanceOf(InventoryPersistenceError);
    });
  });

  // -------------------------------------------------------------------------
  // listTransactionsBySku — SKU history
  // -------------------------------------------------------------------------

  describe('listTransactionsBySku', () => {
    it('queries the transactions GSI1 newest-first, tenant+SKU scoped', async () => {
      const txns = [makeTxn(), makeTxn({ txnId: 'txn-002', timestamp: '2024-01-02T00:00:00.000Z' })];
      ddbMock.on(QueryCommand).resolves({ Items: txns.map(makeTransactionItem) });

      const repo = createRepo();
      const result = await repo.listTransactionsBySku('tenant-abc', 'SKU-123');

      expect(result.items).toHaveLength(2);
      const input = ddbMock.commandCalls(QueryCommand)[0]!.args[0].input;
      expect(input.TableName).toBe(TRANSACTIONS_TABLE);
      expect(input.IndexName).toBe('GSI1');
      expect(input.KeyConditionExpression).toBe('GSI1PK = :gsi1pk');
      expect(input.ExpressionAttributeValues).toEqual({
        ':gsi1pk': 'TENANT#tenant-abc#SKU#SKU-123',
      });
      expect(input.ScanIndexForward).toBe(false); // newest first
    });
  });

  // -------------------------------------------------------------------------
  // Transaction immutability
  // -------------------------------------------------------------------------

  describe('transaction immutability', () => {
    it('InventoryRepository exposes no update/delete transaction methods', () => {
      const repo = createRepo();
      const proto = Object.getPrototypeOf(repo);
      const methods = Object.getOwnPropertyNames(proto);
      expect(methods).not.toContain('updateTransaction');
      expect(methods).not.toContain('deleteTransaction');
      expect(methods).not.toContain('putTransaction');
    });

    it('TransactionRepository exposes only a read method (no mutation)', () => {
      const repo = createTxnRepo();
      const proto = Object.getPrototypeOf(repo);
      const methods = Object.getOwnPropertyNames(proto).filter((m) => m !== 'constructor');
      expect(methods).toContain('listBySku');
      for (const forbidden of ['append', 'create', 'put', 'update', 'delete']) {
        expect(methods).not.toContain(forbidden);
      }
    });
  });
});

describe('TransactionRepository', () => {
  beforeEach(() => {
    ddbMock.reset();
  });

  it('lists a SKU ledger newest-first via GSI1 and paginates', async () => {
    const lastKey = { PK: 'TENANT#t', SK: 'TXN#2024-01-01T00:00:00.000Z#txn-001' };
    ddbMock.on(QueryCommand).resolves({
      Items: [makeTransactionItem(makeTxn())],
      LastEvaluatedKey: lastKey,
    });

    const repo = createTxnRepo();
    const result = await repo.listBySku('tenant-abc', 'SKU-123', { limit: 25 });

    expect(result.items).toHaveLength(1);
    expect(result.nextToken).toBeDefined();
    const input = ddbMock.commandCalls(QueryCommand)[0]!.args[0].input;
    expect(input.IndexName).toBe('GSI1');
    expect(input.ScanIndexForward).toBe(false);
    expect(input.Limit).toBe(25);
    expect(input.ExpressionAttributeValues).toEqual({
      ':gsi1pk': 'TENANT#tenant-abc#SKU#SKU-123',
    });
  });

  it('strips DynamoDB keys from returned ledger entries', async () => {
    ddbMock.on(QueryCommand).resolves({ Items: [makeTransactionItem(makeTxn())] });
    const repo = createTxnRepo();
    const result = await repo.listBySku('tenant-abc', 'SKU-123');
    const entry = result.items[0]! as Record<string, unknown>;
    expect(entry['PK']).toBeUndefined();
    expect(entry['GSI1PK']).toBeUndefined();
    expect(entry['txnId']).toBe('txn-001'); // domain field preserved (not renamed)
  });
});
