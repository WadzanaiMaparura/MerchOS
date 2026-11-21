import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { mockClient } from 'aws-sdk-client-mock';
import { DynamoDBDocumentClient, ScanCommand, UpdateCommand } from '@aws-sdk/lib-dynamodb';
import { EventBridgeClient, PutEventsCommand } from '@aws-sdk/client-eventbridge';
import { DeleteObjectsCommand, ListObjectsV2Command, S3Client } from '@aws-sdk/client-s3';

import { handler, isStale } from '../../handlers/sweep-stuck-imports';

const ddb = mockClient(DynamoDBDocumentClient);
const eb = mockClient(EventBridgeClient);
const s3 = mockClient(S3Client);
const saved = { ...process.env };
Object.assign(process.env, { IMPORT_JOBS_TABLE: 'jobs', RAW_UPLOADS_BUCKET: 'raw', EVENT_BUS_NAME: 'bus' });
afterAll(() => { process.env = saved; });

const ago = (min: number) => new Date(Date.now() - min * 60_000).toISOString();
const job = (status: string, minutesAgo: number, over: Record<string, unknown> = {}) => ({
  tenantId: 't1', importJobId: `j-${status}-${minutesAgo}`, supplierId: 's1', sourceType: 'FILE_CSV',
  status, createdAt: ago(minutesAgo + 1), updatedAt: ago(minutesAgo), errors: [], ...over,
});

describe('isStale', () => {
  it.each([
    ['PROCESSING', 16, true], ['PROCESSING', 10, false],
    ['VALIDATING', 20, true], ['PERSISTING', 14, false],
    ['QUEUED', 61, true], ['QUEUED', 30, false],
    ['AWAITING_UPLOAD', 25 * 60, true], ['AWAITING_UPLOAD', 60, false],
    ['COMPLETED', 99999, false], ['FAILED', 99999, false],
  ])('%s idle %i min -> %s', (status, min, expected) => {
    expect(isStale(job(status, min) as never, Date.now())).toBe(expected);
  });

  it('falls back to createdAt when the job was never updated', () => {
    expect(isStale(job('QUEUED', 0, { updatedAt: undefined, createdAt: ago(90) }) as never, Date.now())).toBe(true);
  });
});

describe('sweeper', () => {
  beforeEach(() => {
    ddb.reset(); eb.reset(); s3.reset();
    eb.on(PutEventsCommand).resolves({ FailedEntryCount: 0, Entries: [] });
    s3.on(ListObjectsV2Command).resolves({ Contents: [{ Key: 'suppliers/t1/s1/work/x/parsed.json' }] });
    s3.on(DeleteObjectsCommand).resolves({});
  });

  it('fails only abandoned jobs, with a seller-readable error, and leaves fresh ones alone', async () => {
    ddb.on(ScanCommand).resolves({ Items: [job('PROCESSING', 30), job('PROCESSING', 2), job('AWAITING_UPLOAD', 2000)] });
    ddb.on(UpdateCommand).resolves({});

    const res = await handler();
    expect(res).toEqual({ scanned: 3, failed: 2 });

    const updates = ddb.commandCalls(UpdateCommand).map((c) => c.args[0].input);
    const statusWrites = updates.filter((u) => u.ExpressionAttributeValues?.[':newStatus'] === 'FAILED');
    expect(statusWrites.map((u) => u.Key?.['SK'])).toEqual(['IMPORT#j-PROCESSING-30', 'IMPORT#j-AWAITING_UPLOAD-2000']);
    // Conditional on the status it was scanned in: a job that just progressed is untouched.
    expect(statusWrites[0]!.ConditionExpression).toBe('#status = :currentStatus');
    const errorWrites = updates.filter((u) => JSON.stringify(u.ExpressionAttributeValues).includes('TIMEOUT'));
    expect(errorWrites).toHaveLength(1);
    expect(eb.commandCalls(PutEventsCommand).map((c) => c.args[0].input.Entries![0]!.DetailType)).toEqual(['ImportJobFailed', 'ImportJobFailed']);
  });

  it('skips a job that moved on between the scan and the write', async () => {
    ddb.on(ScanCommand).resolves({ Items: [job('PROCESSING', 30)] });
    ddb.on(UpdateCommand).rejects(Object.assign(new Error('moved'), { name: 'ConditionalCheckFailedException' }));
    expect(await handler()).toEqual({ scanned: 1, failed: 0 });
    expect(eb.commandCalls(PutEventsCommand)).toHaveLength(0);
  });
});
