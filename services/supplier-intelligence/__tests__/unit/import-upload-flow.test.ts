/**
 * File/image import staging + start, through the real middleware stack
 * (tenant context, RBAC, rate limit). AWS is mocked with aws-sdk-client-mock.
 */
import { describe, it, expect, beforeEach } from 'vitest';
import { DynamoDBDocumentClient, GetCommand, PutCommand, UpdateCommand } from '@aws-sdk/lib-dynamodb';
import { S3Client, HeadObjectCommand, PutObjectCommand } from '@aws-sdk/client-s3';
import { SQSClient, SendMessageCommand } from '@aws-sdk/client-sqs';
import { mockClient } from 'aws-sdk-client-mock';

const ddbMock = mockClient(DynamoDBDocumentClient);
const s3Mock = mockClient(S3Client);
const sqsMock = mockClient(SQSClient);

const ISS = 'https://cognito-idp.eu-west-1.amazonaws.com/eu-west-1_test';
process.env['COGNITO_ISSUER'] = ISS;
process.env['IMPORT_JOBS_TABLE'] = 'import-jobs-test';
process.env['RAW_UPLOADS_BUCKET'] = 'raw-test';
process.env['IMPORT_QUEUE_URL'] = 'https://sqs.eu-west-1.amazonaws.com/123/q.fifo';
process.env['AWS_ACCESS_KEY_ID'] = 'AKIDEXAMPLE';
process.env['AWS_SECRET_ACCESS_KEY'] = 'secret';
process.env['AWS_REGION'] = 'eu-west-1';

const { handler: triggerFile } = await import('../../handlers/trigger-file-import');
const { handler: triggerImages } = await import('../../handlers/trigger-image-import');
const { handler: startImport } = await import('../../handlers/start-import');

const TENANT = 'tenant-1';
function event(opts: { body?: unknown; pathParameters?: Record<string, string>; tenant?: string } = {}) {
  return {
    version: '2.0',
    headers: { 'content-type': 'application/json' },
    pathParameters: opts.pathParameters,
    requestContext: {
      http: { method: 'POST', sourceIp: '1.1.1.1' },
      authorizer: {
        jwt: {
          claims: {
            sub: 'u-1',
            iss: ISS,
            exp: Math.floor(Date.now() / 1000) + 600,
            'cognito:groups': ['Seller'],
            'custom:tenantId': opts.tenant ?? TENANT,
            token_use: 'access',
          },
        },
      },
    },
    body: opts.body === undefined ? undefined : JSON.stringify(opts.body),
    isBase64Encoded: false,
  } as never;
}
type Res = { statusCode: number; body: string };
const call = async (h: unknown, e: unknown) => {
  const r = (await (h as (e: unknown, c: unknown) => Promise<Res>)(e, {})) as Res;
  return { status: r.statusCode, json: JSON.parse(r.body || '{}') };
};
const jobPuts = () =>
  ddbMock.commandCalls(PutCommand).filter((c) => c.args[0].input.TableName === 'import-jobs-test');

beforeEach(() => {
  ddbMock.reset();
  s3Mock.reset();
  sqsMock.reset();
  ddbMock.on(UpdateCommand).resolves({}); // rate limiter + status updates
  ddbMock.on(PutCommand).resolves({});
  sqsMock.on(SendMessageCommand).resolves({ MessageId: 'm-1' });
});

describe('POST /suppliers/{id}/imports/file (staging)', () => {
  const body = { fileName: '../../My Stock (final).csv', contentType: 'text/csv', fileSizeBytes: 2048 };

  it('creates the job as AWAITING_UPLOAD and returns a presigned PUT, queuing NOTHING', async () => {
    const { status, json } = await call(triggerFile, event({ body, pathParameters: { supplierId: 'sup-1' } }));
    expect(status).toBe(201);
    expect(json.status).toBe('AWAITING_UPLOAD');
    expect(json.startUrl).toBe(`/imports/${json.importJobId}/start`);
    expect(json.uploads).toHaveLength(1);
    const u = json.uploads[0];
    expect(u.method).toBe('PUT');
    expect(u.headers).toEqual({ 'Content-Type': 'text/csv' });
    expect(new URL(u.url).pathname).toBe(`/${u.key}`);

    // Nothing queued, and no empty placeholder object written (the old bug).
    expect(sqsMock.commandCalls(SendMessageCommand)).toHaveLength(0);
    expect(s3Mock.commandCalls(PutObjectCommand)).toHaveLength(0);

    const item = jobPuts()[0]!.args[0].input.Item!;
    expect(item['status']).toBe('AWAITING_UPLOAD');
    expect(item['GSI2PK']).toBe(`TENANT#${TENANT}#STATUS#AWAITING_UPLOAD`);
    expect(item['pendingUploads']).toEqual([
      { key: u.key, contentType: 'text/csv', sizeBytes: 2048, originalFileName: '../../My Stock (final).csv' },
    ]);
    expect((item['queueMessage'] as Record<string, unknown>)['sourceReference']).toBe(u.key);
  });

  it('builds the key from the tenant, supplier and job, with a sanitised file name', async () => {
    const { json } = await call(triggerFile, event({ body, pathParameters: { supplierId: 'sup-1' } }));
    const key: string = json.uploads[0].key;
    expect(key).toBe(`suppliers/${TENANT}/sup-1/files/${json.importJobId}/My_Stock_final_.csv`);
    expect(key).not.toContain('..');
  });

  it.each([
    ['unsupported type', { ...body, contentType: 'application/x-msdownload' }],
    ['too large', { ...body, fileSizeBytes: 51 * 1024 * 1024 }],
    ['zero bytes', { ...body, fileSizeBytes: 0 }],
  ])('rejects a %s before creating anything', async (_n, bad) => {
    const { status } = await call(triggerFile, event({ body: bad, pathParameters: { supplierId: 'sup-1' } }));
    expect(status).toBe(400);
    expect(jobPuts()).toHaveLength(0);
  });
});

describe('POST /suppliers/{id}/imports/images (staging)', () => {
  const img = (name: string) => ({ fileName: name, contentType: 'image/png', fileSizeBytes: 100 });

  it('returns one presigned PUT per image; same-named images never collide', async () => {
    const { status, json } = await call(
      triggerImages,
      event({ body: { images: [img('photo.png'), img('photo.png'), img('a/b.png')] }, pathParameters: { supplierId: 'sup-1' } })
    );
    expect(status).toBe(201);
    const keys: string[] = json.uploads.map((u: { key: string }) => u.key);
    expect(keys).toHaveLength(3);
    expect(new Set(keys).size).toBe(3);
    expect(keys[0]).toMatch(/\/001-photo\.png$/);
    expect(keys[1]).toMatch(/\/002-photo\.png$/);
    expect(keys[2]).toMatch(/\/003-b\.png$/);
    expect(sqsMock.commandCalls(SendMessageCommand)).toHaveLength(0);
    const msg = jobPuts()[0]!.args[0].input.Item!['queueMessage'] as { images: Array<{ s3Key: string }> };
    expect(msg.images.map((i) => i.s3Key)).toEqual(keys);
  });

  it('refuses more than 50 images (bounds how many upload URLs one request can mint)', async () => {
    const images = Array.from({ length: 51 }, (_, i) => img(`p${i}.png`));
    const { status } = await call(triggerImages, event({ body: { images }, pathParameters: { supplierId: 'sup-1' } }));
    expect(status).toBe(400);
    expect(jobPuts()).toHaveLength(0);
  });
});

describe('POST /imports/{importJobId}/start', () => {
  const JOB = 'job-123';
  const pending = [{ key: 'suppliers/tenant-1/sup-1/files/job-123/p.csv', contentType: 'text/csv', sizeBytes: 2048, originalFileName: 'p.csv' }];
  const queueMessage = { importJobId: JOB, tenantId: TENANT, supplierId: 'sup-1', sourceType: 'FILE_CSV', sourceReference: pending[0]!.key };
  const awaitingJob = { PK: `TENANT#${TENANT}`, SK: `IMPORT#${JOB}`, importJobId: JOB, status: 'AWAITING_UPLOAD', pendingUploads: pending, queueMessage };
  const start = (id = JOB, tenant?: string) => call(startImport, event({ pathParameters: { importJobId: id }, ...(tenant ? { tenant } : {}) }));
  const statusUpdates = () =>
    ddbMock.commandCalls(UpdateCommand).filter((c) => c.args[0].input.TableName === 'import-jobs-test');

  beforeEach(() => {
    ddbMock.on(GetCommand).resolves({ Item: awaitingJob });
    s3Mock.on(HeadObjectCommand).resolves({ ContentLength: 2048, ContentType: 'text/csv' });
  });

  it('verifies the upload, claims the job (AWAITING_UPLOAD -> QUEUED), then queues it', async () => {
    const { status, json } = await start();
    expect(status).toBe(202);
    expect(json).toEqual({ importJobId: JOB, status: 'QUEUED' });

    const upd = statusUpdates()[0]!.args[0].input;
    expect(upd.ConditionExpression).toBe('#status = :awaiting');
    expect(upd.ExpressionAttributeValues![':queued']).toBe('QUEUED');
    expect(upd.ExpressionAttributeValues![':gsi2']).toBe(`TENANT#${TENANT}#STATUS#QUEUED`);

    const sent = sqsMock.commandCalls(SendMessageCommand)[0]!.args[0].input;
    expect(JSON.parse(sent.MessageBody!)).toEqual(queueMessage);
    expect(sent.MessageGroupId).toBe(TENANT);
    expect(sent.MessageDeduplicationId).toBe(JOB);
  });

  it('reads the job under the CALLER tenant: another tenant gets 404 and nothing is queued', async () => {
    ddbMock.on(GetCommand, { Key: { PK: 'TENANT#other', SK: `IMPORT#${JOB}` } }).resolves({});
    const { status } = await start(JOB, 'other');
    expect(status).toBe(404);
    expect(sqsMock.commandCalls(SendMessageCommand)).toHaveLength(0);
  });

  it('refuses to start until the file is really uploaded (409), and changes nothing', async () => {
    s3Mock.on(HeadObjectCommand).rejects(Object.assign(new Error('nf'), { name: 'NotFound', $metadata: { httpStatusCode: 404 } }));
    const { status, json } = await start();
    expect(status).toBe(409);
    expect(json.error.code).toBe('UPLOAD_INCOMPLETE');
    expect(statusUpdates()).toHaveLength(0);
    expect(sqsMock.commandCalls(SendMessageCommand)).toHaveLength(0);
  });

  it('refuses an upload whose size differs from what was declared', async () => {
    s3Mock.on(HeadObjectCommand).resolves({ ContentLength: 1, ContentType: 'text/csv' });
    const { status, json } = await start();
    expect(status).toBe(409);
    expect(json.error.message).toMatch(/size/);
  });

  it('is idempotent: a job that already started is reported, not queued again', async () => {
    ddbMock.on(GetCommand).resolves({ Item: { ...awaitingJob, status: 'PROCESSING' } });
    const { status, json } = await start();
    expect(status).toBe(200);
    expect(json).toEqual({ importJobId: JOB, status: 'PROCESSING', alreadyStarted: true });
    expect(sqsMock.commandCalls(SendMessageCommand)).toHaveLength(0);
  });

  it('a concurrent double-start queues the import only once', async () => {
    ddbMock
      .on(UpdateCommand, { TableName: 'import-jobs-test' })
      .rejects(Object.assign(new Error('cc'), { name: 'ConditionalCheckFailedException' }));
    const { status, json } = await start();
    expect(status).toBe(200);
    expect(json.alreadyStarted).toBe(true);
    expect(sqsMock.commandCalls(SendMessageCommand)).toHaveLength(0);
  });

  it('if queuing fails after the claim, puts the job back to AWAITING_UPLOAD so it can be retried', async () => {
    sqsMock.on(SendMessageCommand).rejects(new Error('sqs down'));
    const { status, json } = await start();
    expect(status).toBe(500);
    expect(json.error.code).toBe('IMPORT_START_FAILED');
    const updates = statusUpdates().map((c) => c.args[0].input);
    expect(updates).toHaveLength(2);
    expect(updates[1]!.ExpressionAttributeValues![':awaiting']).toBe('AWAITING_UPLOAD');
    expect(updates[1]!.ExpressionAttributeValues![':pending']).toEqual(pending);
    expect(updates[1]!.ConditionExpression).toBe('#status = :queued');
  });

  it.each(['../x', 'a b', 'x'.repeat(101)])('rejects a malformed job id (%j)', async (id) => {
    const { status } = await start(id);
    expect(status).toBe(400);
  });

  it('never leaks internals on an unexpected error', async () => {
    ddbMock.on(GetCommand).rejects(new Error('arn:aws:dynamodb secret detail'));
    const { status, json } = await start();
    expect(status).toBe(500);
    expect(JSON.stringify(json)).not.toContain('secret detail');
  });
});

