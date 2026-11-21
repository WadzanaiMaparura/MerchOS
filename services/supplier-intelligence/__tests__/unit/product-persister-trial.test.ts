/**
 * Free-trial gate in the import persister.
 *
 * A bulk import must create only what the seller's trial allows and report the
 * rest. BatchWriteItem cannot carry conditions, so the cap has to be applied
 * BEFORE writing; these tests lock that in, including the failure paths.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { DynamoDBDocumentClient, BatchWriteCommand, UpdateCommand } from '@aws-sdk/lib-dynamodb';
import { EventBridgeClient, PutEventsCommand } from '@aws-sdk/client-eventbridge';
import { mockClient } from 'aws-sdk-client-mock';

const reserveProductSlots = vi.fn();
const releaseProductSlot = vi.fn();
vi.mock('../../../shared/entitlements/trial-gate', () => ({
  reserveProductSlots: (...a: unknown[]) => reserveProductSlots(...a),
  releaseProductSlot: (...a: unknown[]) => releaseProductSlot(...a),
}));

import {
  persistProducts,
  setDynamoClient,
  resetDynamoClient,
  type PersistProductsParams,
  type ProductToPersist,
} from '../../processors/product-persister';
import { setDynamoDocClient } from '../../utils/import-job-status';
import { resetForTesting as resetEventBridgeClient } from '../../utils/event-emitter';

const ebMock = mockClient(EventBridgeClient);
const ddbMock = mockClient(DynamoDBDocumentClient);

const product = (i: number): ProductToPersist => ({
  productId: `p${i}`,
  record: { title: `Product ${i}`, sku: `SKU-${i}`, description: 'd' },
  importMetadata: { sourceImportJobId: 'job-1', sourceSupplierId: 'sup-1', sourceType: 'FILE_CSV', importedAt: '2026-11-18T00:00:00.000Z' },
});
const params = (n: number): PersistProductsParams => ({
  tenantId: 'tenant-abc',
  importJobId: 'job-1',
  supplierId: 'sup-1',
  sourceType: 'FILE_CSV',
  products: Array.from({ length: n }, (_, i) => product(i)),
  productsTableName: 'products-test',
  importJobsTableName: 'import-jobs-test',
});

const writtenIds = () =>
  ddbMock.commandCalls(BatchWriteCommand).flatMap((c) =>
    (c.args[0].input.RequestItems!['products-test'] ?? []).map((r) => (r.PutRequest!.Item as { SK: string }).SK.replace('PRODUCT#', '')),
  );
const jobUpdate = () => ddbMock.commandCalls(UpdateCommand)[0]!.args[0].input;

beforeEach(() => {
  ddbMock.reset();
  ebMock.reset();
  resetEventBridgeClient();
  setDynamoClient(ddbMock as unknown as DynamoDBDocumentClient);
  setDynamoDocClient(ddbMock as unknown as DynamoDBDocumentClient);
  ddbMock.on(BatchWriteCommand).resolves({ UnprocessedItems: {} });
  ddbMock.on(UpdateCommand).resolves({});
  ebMock.on(PutEventsCommand).resolves({ FailedEntryCount: 0, Entries: [{}] });
  reserveProductSlots.mockReset();
  releaseProductSlot.mockReset().mockResolvedValue(undefined);
  vi.stubEnv('EVENT_BUS_NAME', 'test-event-bus');
  vi.stubEnv('AWS_REGION', 'eu-west-1');
});
afterEach(() => {
  resetDynamoClient();
  resetEventBridgeClient();
  vi.unstubAllEnvs();
});

describe('persistProducts with the free-trial gate', () => {
  it('reserves a slot for every product BEFORE writing anything', async () => {
    let writesWhenReserving = -1;
    reserveProductSlots.mockImplementation(async (_t: string, ids: string[]) => {
      writesWhenReserving = ddbMock.commandCalls(BatchWriteCommand).length;
      return { allowed: ids, blocked: [] };
    });
    await persistProducts(params(3));
    expect(reserveProductSlots).toHaveBeenCalledWith('tenant-abc', ['p0', 'p1', 'p2'], { tableName: 'products-test' });
    expect(writesWhenReserving).toBe(0); // nothing had been written yet
    expect(ddbMock.commandCalls(BatchWriteCommand)).toHaveLength(1); // and then it was
  });

  it('writes ONLY the products the gate allowed and reports the rest as blocked, not failed', async () => {
    reserveProductSlots.mockResolvedValue({ allowed: ['p0', 'p1'], blocked: ['p2', 'p3', 'p4'], reason: 'TRIAL_LIMIT_REACHED' });
    const r = await persistProducts(params(5));
    expect(writtenIds()).toEqual(['p0', 'p1']);
    expect(r.persisted).toBe(2);
    expect(r.failed).toBe(0); // blocked is not a failure
    expect(r.jobResults).toMatchObject({ totalExtracted: 5, created: 2, blockedByTrial: 3 });
  });

  it('a 1000-row file can never write more than the gate allows (no bypass via BatchWrite)', async () => {
    const allowed = Array.from({ length: 15 }, (_, i) => `p${i}`);
    reserveProductSlots.mockResolvedValue({ allowed, blocked: Array.from({ length: 985 }, (_, i) => `p${i + 15}`), reason: 'TRIAL_LIMIT_REACHED' });
    const r = await persistProducts(params(1000));
    expect(writtenIds()).toHaveLength(15);
    expect(r.jobResults.blockedByTrial).toBe(985);
  });

  it('writes nothing, but still completes the job, when the trial was never activated', async () => {
    reserveProductSlots.mockResolvedValue({ allowed: [], blocked: ['p0', 'p1'], reason: 'TRIAL_NOT_ACTIVATED' });
    const r = await persistProducts(params(2));
    expect(ddbMock.commandCalls(BatchWriteCommand)).toHaveLength(0);
    expect(r.persisted).toBe(0);
    expect(r.jobResults.blockedByTrial).toBe(2);
    expect(jobUpdate().ExpressionAttributeValues).toBeDefined(); // job was still marked COMPLETED
  });

  it('explains the truncation to the seller in the job step text', async () => {
    reserveProductSlots.mockResolvedValue({ allowed: ['p0'], blocked: ['p1'], reason: 'TRIAL_LIMIT_REACHED' });
    await persistProducts(params(2));
    const values = JSON.stringify(jobUpdate());
    expect(values).toMatch(/1 imported, 1 not imported because the free trial limit was reached/);
  });

  it('omits blockedByTrial entirely when nothing was blocked', async () => {
    reserveProductSlots.mockImplementation(async (_t: string, ids: string[]) => ({ allowed: ids, blocked: [] }));
    const r = await persistProducts(params(2));
    expect(r.jobResults).not.toHaveProperty('blockedByTrial');
  });

  it('gives back slots for products never attempted after a failing batch, but keeps the failing batch used', async () => {
    // 60 allowed -> batches of 25: [0-24] ok, [25-49] FAILS, [50-59] never attempted.
    const ids = Array.from({ length: 60 }, (_, i) => `p${i}`);
    reserveProductSlots.mockResolvedValue({ allowed: ids, blocked: [] });
    ddbMock.on(BatchWriteCommand).resolvesOnce({ UnprocessedItems: {} }).rejectsOnce(new Error('dynamo down'));
    const r = await persistProducts(params(60));
    expect(r.persisted).toBe(25);
    expect(r.failureAtIndex).toBe(25);
    const released = releaseProductSlot.mock.calls.map((c) => c[1]);
    // Only the 10 never-attempted products are released; the possibly part-written batch is not.
    expect(released).toEqual(ids.slice(50));
  });

  it('releases nothing when every batch succeeds', async () => {
    reserveProductSlots.mockImplementation(async (_t: string, ids: string[]) => ({ allowed: ids, blocked: [] }));
    await persistProducts(params(30));
    expect(releaseProductSlot).not.toHaveBeenCalled();
  });
});
