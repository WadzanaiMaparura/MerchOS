/**
 * Chains the real Step Functions task handlers (workflow/*.ts) the way the
 * state machine does: each step receives the whole state plus the previous
 * step's { result } and hands only an S3 key on. S3 is an in-memory map and
 * DynamoDB a small fake that enforces the import-job status conditions.
 */
import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { mockClient } from 'aws-sdk-client-mock';
import {
  DeleteObjectsCommand, GetObjectCommand, ListObjectsV2Command, PutObjectCommand, S3Client,
} from '@aws-sdk/client-s3';
import {
  BatchWriteCommand, DynamoDBDocumentClient, GetCommand, QueryCommand, UpdateCommand,
} from '@aws-sdk/lib-dynamodb';
import { EventBridgeClient, PutEventsCommand } from '@aws-sdk/client-eventbridge';

import { handler as parseFile } from '../../workflow/parse-file';
import { handler as validate } from '../../workflow/validate';
import { handler as detectDuplicates } from '../../workflow/detect-duplicates';
import { handler as persist, describeFailure } from '../../workflow/persist';
import type { StepOutput, WorkflowInput } from '../../workflow/shared';

const s3Mock = mockClient(S3Client);
const ddbMock = mockClient(DynamoDBDocumentClient);
const ebMock = mockClient(EventBridgeClient);

const ENV = {
  RAW_UPLOADS_BUCKET: 'raw',
  ASSETS_BUCKET: 'assets',
  IMPORT_JOBS_TABLE: 'jobs',
  SUPPLIERS_TABLE: 'suppliers',
  PRODUCTS_TABLE_NAME: 'products',
  EVENT_BUS_NAME: 'bus',
};
const saved: Record<string, string | undefined> = {};
for (const [k, v] of Object.entries(ENV)) { saved[k] = process.env[k]; process.env[k] = v; }
afterAll(() => { for (const [k, v] of Object.entries(saved)) { if (v === undefined) delete process.env[k]; else process.env[k] = v; } });

// --- fakes -------------------------------------------------------------------

let objects: Map<string, string>;
let job: Record<string, unknown>;
let strategy: string;
let products: Map<string, Record<string, unknown>>; // SK -> item

function conditionalFailure(): Error {
  const e = new Error('The conditional request failed');
  e.name = 'ConditionalCheckFailedException';
  return e;
}

function setPath(target: Record<string, unknown>, path: string[], value: unknown) {
  let o = target;
  for (const seg of path.slice(0, -1)) o = (o[seg] ??= {}) as Record<string, unknown>;
  o[path[path.length - 1]!] = value;
}

/** Applies "SET #a = :x, #b.#c = :y" style updates (all this code emits). */
function applySet(item: Record<string, unknown>, expr: string, names: Record<string, string>, values: Record<string, unknown>) {
  for (const part of expr.replace(/^SET\s+/, '').split(',')) {
    const [lhs, rhs] = part.split('=').map((s) => s.trim());
    setPath(item, lhs!.split('.').map((n) => names[n] ?? n), values[rhs!]);
  }
}

beforeEach(() => {
  s3Mock.reset(); ddbMock.reset(); ebMock.reset();
  objects = new Map([['suppliers/t1/s1/files/j1/products.csv',
    'title,sku,price,description,brand\n' +
    'Kettle,K-1,349.99,Steel kettle,Acme\n' +
    'Toaster,T-1,R 499,2-slice toaster,Acme\n' +
    ',NO-TITLE,10,Missing title,Acme\n' +
    'Kettle again,K-1,300,Same SKU as row 1,Acme\n' +
    'Existing blender,B-1,899.50,Already in the catalogue,Acme\n']]);
  job = { PK: 'TENANT#t1', SK: 'IMPORT#j1', importJobId: 'j1', tenantId: 't1', supplierId: 's1', sourceType: 'FILE_CSV', status: 'PROCESSING', errors: [], startedAt: new Date().toISOString() };
  strategy = 'SKIP';
  products = new Map([['PRODUCT#existing-b1', { PK: 'TENANT#t1', SK: 'PRODUCT#existing-b1', productId: 'existing-b1', GSI1SK: 'SKU#B-1', content: { title: 'Old blender', sku: 'B-1', brand: 'Seller edit' }, commercial: { sellingPrice: 1000 } }]]);

  s3Mock.on(PutObjectCommand).callsFake((i) => { objects.set(i.Key, String(i.Body)); return {}; });
  s3Mock.on(GetObjectCommand).callsFake((i) => {
    const body = objects.get(i.Key);
    if (body === undefined) { const e = new Error('NoSuchKey'); e.name = 'NoSuchKey'; throw e; }
    return { Body: { transformToByteArray: async () => new TextEncoder().encode(body) } };
  });
  s3Mock.on(ListObjectsV2Command).callsFake((i) => ({ Contents: [...objects.keys()].filter((k) => k.startsWith(i.Prefix)).map((Key) => ({ Key })) }));
  s3Mock.on(DeleteObjectsCommand).callsFake((i) => { for (const o of i.Delete.Objects) objects.delete(o.Key); return {}; });

  ddbMock.on(GetCommand).callsFake((i) => {
    if (i.TableName === 'jobs') return { Item: structuredClone(job) };
    if (i.TableName === 'suppliers') return { Item: { duplicateStrategy: strategy } };
    return {};
  });
  ddbMock.on(UpdateCommand).callsFake((i) => {
    const names = i.ExpressionAttributeNames ?? {};
    const values = i.ExpressionAttributeValues ?? {};
    if (i.TableName === 'jobs') {
      if (values[':currentStatus'] !== undefined && job['status'] !== values[':currentStatus']) throw conditionalFailure();
      applySet(job, i.UpdateExpression, names, values);
      return {};
    }
    const item = products.get(i.Key.SK);
    if (!item) throw conditionalFailure();
    applySet(item, i.UpdateExpression, names, values);
    return {};
  });
  ddbMock.on(QueryCommand).callsFake((i) => {
    if (i.IndexName !== 'GSI1') { const e = new Error('denied'); e.name = 'AccessDeniedException'; throw e; }
    const hit = [...products.values()].find((p) => p['GSI1SK'] === i.ExpressionAttributeValues[':sk']);
    return { Items: hit ? [{ productId: hit['productId'] }] : [] };
  });
  ddbMock.on(BatchWriteCommand).callsFake((i) => {
    for (const r of i.RequestItems.products) products.set(r.PutRequest.Item.SK, r.PutRequest.Item);
    return {};
  });
  ebMock.on(PutEventsCommand).resolves({ FailedEntryCount: 0, Entries: [] });
});

const base: WorkflowInput = {
  importJobId: 'j1', tenantId: 't1', supplierId: 's1', sourceType: 'FILE_CSV',
  sourceReference: 'suppliers/t1/s1/files/j1/products.csv', fileName: 'products.csv',
};

async function runAll(input: WorkflowInput = base) {
  const parsed = await parseFile(input);
  const s1 = { ...input, parseResult: { result: parsed } };
  const validated = await validate(s1);
  const s2 = { ...s1, validationResult: { result: validated } };
  const deduped = await detectDuplicates(s2);
  const s3 = { ...s2, deduplicationResult: { result: deduped } };
  const out = await persist(s3);
  return { parsed, validated, deduped, state: s3, out };
}

const newProducts = () => [...products.values()].filter((p) => p['productId'] !== 'existing-b1');

describe('import workflow (Step Functions task handlers)', () => {
  it('parses, validates, de-duplicates and persists a CSV end to end', async () => {
    const { parsed, validated } = await runAll();

    expect(parsed).toEqual<StepOutput>({ key: 'suppliers/t1/s1/work/j1/parsed.json', count: 5 });
    expect(validated.count).toBe(4); // the row without a title fails

    expect(job['status']).toBe('COMPLETED');
    expect(job['GSI2PK']).toBe('TENANT#t1#STATUS#COMPLETED');
    // SKIP: B-1 exists already, and row 4 repeats K-1 from row 1.
    expect(job['results']).toEqual({ totalExtracted: 5, created: 2, updated: 0, duplicates: 2, validationFailed: 1 });
    expect(job['validationSummary']).toMatchObject({ totalRecords: 5, passed: 4, failed: 1 });
    // Spreadsheet row numbers (header = row 1), as the seller sees them in Excel.
    expect((job['errors'] as Array<{ message: string }>)[0]!.message).toMatch(/^Row 4: /);

    const created = newProducts();
    expect(created.map((p) => (p['content'] as { sku: string }).sku).sort()).toEqual(['K-1', 'T-1']);
    const kettle = created.find((p) => (p['content'] as { sku: string }).sku === 'K-1')!;
    expect((kettle['commercial'] as { sellingPrice: number }).sellingPrice).toBe(349.99);
    expect(kettle['lifecycleState']).toBe('draft');

    // Existing product untouched; work files cleaned up; event emitted.
    expect((products.get('PRODUCT#existing-b1')!['content'] as { title: string }).title).toBe('Old blender');
    expect([...objects.keys()].filter((k) => k.includes('/work/'))).toEqual([]);
    const detail = JSON.parse(ebMock.commandCalls(PutEventsCommand)[0]!.args[0].input.Entries![0]!.Detail!);
    expect(detail.results.created).toBe(2);
  });

  it('MERGE updates only the supplied fields of the existing product', async () => {
    strategy = 'MERGE';
    await runAll();
    const b1 = products.get('PRODUCT#existing-b1')!;
    expect(b1['content']).toMatchObject({ title: 'Existing blender', sku: 'B-1', longDescription: 'Already in the catalogue', brand: 'Acme' });
    expect((b1['commercial'] as { sellingPrice: number }).sellingPrice).toBe(899.5);
    expect(job['results']).toMatchObject({ created: 2, updated: 1, duplicates: 2 });
  });

  it('CREATE_FLAGGED creates duplicates with duplicateOf set', async () => {
    strategy = 'CREATE_FLAGGED';
    await runAll();
    const created = newProducts();
    expect(created).toHaveLength(4);
    const flagged = created.filter((p) => ((p['content'] as { attributes: { importMetadata: { duplicateOf?: string } } }).attributes.importMetadata.duplicateOf));
    expect(flagged).toHaveLength(2);
    expect(flagged.map((p) => (p['content'] as { attributes: { importMetadata: { duplicateOf: string } } }).attributes.importMetadata.duplicateOf)).toContain('existing-b1');
  });

  it('a retried persist step does not create a second copy of the products', async () => {
    const { state } = await runAll();
    const before = newProducts().length;
    const again = await persist(state);
    expect(again).toMatchObject({ alreadyCompleted: true });
    expect(newProducts()).toHaveLength(before);
  });

  it('a retried validate step tolerates the job already being VALIDATING', async () => {
    const parsed = await parseFile(base);
    const s1 = { ...base, parseResult: { result: parsed } };
    await validate(s1);
    await expect(validate(s1)).resolves.toMatchObject({ count: 4 });
  });

  it('a file with no product rows fails with a non-retryable, seller-readable error', async () => {
    objects.set(base.sourceReference, 'title,sku,price\n');
    await expect(parseFile(base)).rejects.toMatchObject({ name: 'ImportInputError', message: expect.stringMatching(/^\[NO_PRODUCTS_FOUND\]/) });
  });

  it('RECORD_FAILURE marks the job FAILED with the seller-facing message', async () => {
    objects.set(base.sourceReference, 'title,sku\n,\n');
    let caught: Error | undefined;
    const parsed = await parseFile(base);
    try { await validate({ ...base, parseResult: { result: parsed } }); } catch (e) { caught = e as Error; }
    expect(caught?.name).toBe('ImportInputError');

    // What Step Functions' Catch hands HandleFailure.
    const res = await persist({
      action: 'RECORD_FAILURE', jobId: 'j1', tenantId: 't1',
      error: { Error: 'ImportInputError', Cause: JSON.stringify({ errorType: caught!.name, errorMessage: caught!.message }) },
    });
    expect(res).toMatchObject({ recorded: true, code: 'ALL_RECORDS_INVALID' });
    expect(job['status']).toBe('FAILED');
    expect(job['GSI2PK']).toBe('TENANT#t1#STATUS#FAILED');
    expect((job['errors'] as Array<{ code: string }>).at(-1)!.code).toBe('ALL_RECORDS_INVALID');
    expect([...objects.keys()].filter((k) => k.includes('/work/'))).toEqual([]);
    const types = ebMock.commandCalls(PutEventsCommand).map((c) => c.args[0].input.Entries![0]!.DetailType);
    expect(types).toEqual(['ImportJobFailed']);

    // Idempotent: a second RECORD_FAILURE leaves it alone.
    await expect(persist({ action: 'RECORD_FAILURE', jobId: 'j1', tenantId: 't1', error: {} })).resolves.toMatchObject({ recorded: false });
  });

  it('describeFailure never leaks internal error details to the seller', () => {
    expect(describeFailure({ Error: 'AccessDeniedException', Cause: JSON.stringify({ errorType: 'AccessDeniedException', errorMessage: 'arn:aws:iam::123:role/x is not authorized' }) }))
      .toEqual({ code: 'PROCESSING_ERROR', message: expect.not.stringContaining('arn:') });
    expect(describeFailure({ Error: 'States.Timeout' }).code).toBe('TIMEOUT');
    expect(describeFailure({ Error: 'UNSUPPORTED_SOURCE_TYPE', Cause: 'x' }).code).toBe('UNSUPPORTED_SOURCE_TYPE');
  });
});

describe('imported images are kept on the product', () => {
  it('stores CSV image URLs (in order, de-duplicated) and drops non-images', async () => {
    objects.set(base.sourceReference,
      'title,sku,price,description,image_url\n' +
      '"Kettle",K-9,10,Steel,"https://cdn.example.com/k1.jpg;https://cdn.example.com/k2.png;https://cdn.example.com/k1.jpg;kettle.jpg"\n');
    await runAll();
    const kettle = newProducts().find((p) => (p['content'] as { sku: string }).sku === 'K-9')!;
    const refs = (kettle['content'] as { imageRefs: Array<{ s3Key: string; position: number; mimeType: string; imageId: string }> }).imageRefs;
    expect(refs.map((r) => r.s3Key)).toEqual(['https://cdn.example.com/k1.jpg', 'https://cdn.example.com/k2.png']);
    expect(refs.map((r) => r.position)).toEqual([0, 1]);
    expect(refs[1]!.mimeType).toBe('image/png');
    // Deterministic ids, so a retried import writes the same refs.
    expect(refs[0]!.imageId).toBe(`${kettle['productId']}-img-0`);
  });
});
