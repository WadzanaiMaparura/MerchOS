import { describe, it, expect, beforeEach } from 'vitest';
import { S3Client, HeadObjectCommand } from '@aws-sdk/client-s3';
import { mockClient } from 'aws-sdk-client-mock';
import {
  sanitizeFileName,
  presignUpload,
  verifyUploads,
  UPLOAD_URL_TTL_SECONDS,
  type PendingUpload,
} from '../../utils/upload-staging';

describe('sanitizeFileName', () => {
  it.each([
    ['products.csv', 'products.csv'],
    ['My Price List (2026).xlsx', 'My_Price_List_2026_.xlsx'],
    ['../../etc/passwd', 'passwd'],
    ['C:\\Users\\me\\Desktop\\stock.csv', 'stock.csv'],
    ['.env', 'env'],
    ['...hidden', 'hidden'],
    ['a..b.csv', 'a.b.csv'],
    ['Zoë café 東京.pdf', 'Zoe_cafe_.pdf'],
    ['', 'upload'],
    ['////', 'upload'],
    ['$$$', 'upload'],
  ])('%j -> %j', (input, expected) => {
    expect(sanitizeFileName(input)).toBe(expected);
  });

  it('never contains a path separator or a parent-directory segment', () => {
    for (const nasty of ['a/b/c.csv', 'x\\y.csv', '../a.csv', 'a/../../b.csv']) {
      const out = sanitizeFileName(nasty);
      expect(out).not.toMatch(/[\\/]/);
      expect(out).not.toContain('..');
    }
  });

  it('bounds the length but keeps the extension', () => {
    const out = sanitizeFileName(`${'a'.repeat(500)}.xlsx`);
    expect(out.length).toBeLessThanOrEqual(120);
    expect(out.endsWith('.xlsx')).toBe(true);
  });
});

describe('presignUpload', () => {
  const s3 = new S3Client({
    region: 'eu-west-1',
    credentials: { accessKeyId: 'AKIDEXAMPLE', secretAccessKey: 'secret' },
  });
  const upload: PendingUpload = {
    key: 'suppliers/t1/s1/files/job-1/products.csv',
    contentType: 'text/csv',
    sizeBytes: 1234,
    originalFileName: 'products.csv',
  };

  it('signs a PUT to the exact key that binds Content-Type and Content-Length, and expires', async () => {
    const now = new Date('2026-11-19T10:00:00.000Z');
    const r = await presignUpload(s3, 'raw-bucket', upload, { importjobid: 'job-1' }, now);
    const url = new URL(r.url);
    expect(url.hostname).toBe('raw-bucket.s3.eu-west-1.amazonaws.com');
    expect(url.pathname).toBe('/suppliers/t1/s1/files/job-1/products.csv');
    expect(url.searchParams.get('X-Amz-Expires')).toBe(String(UPLOAD_URL_TTL_SECONDS));
    const signed = (url.searchParams.get('X-Amz-SignedHeaders') ?? '').split(';');
    expect(signed).toEqual(expect.arrayContaining(['content-length', 'content-type', 'host']));
    expect(r.method).toBe('PUT');
    expect(r.headers).toEqual({ 'Content-Type': 'text/csv' });
    expect(r.expiresAt).toBe('2026-11-19T10:15:00.000Z');
  });
});

describe('verifyUploads', () => {
  const s3Mock = mockClient(S3Client);
  const s3 = new S3Client({ region: 'eu-west-1' });
  const uploads: PendingUpload[] = [
    { key: 'k1', contentType: 'image/png', sizeBytes: 10, originalFileName: 'a.png' },
    { key: 'k2', contentType: 'image/png', sizeBytes: 20, originalFileName: 'b.png' },
  ];
  beforeEach(() => s3Mock.reset());

  it('passes when every object exists with the declared size and type', async () => {
    s3Mock.on(HeadObjectCommand, { Key: 'k1' }).resolves({ ContentLength: 10, ContentType: 'image/png' });
    s3Mock.on(HeadObjectCommand, { Key: 'k2' }).resolves({ ContentLength: 20, ContentType: 'image/png' });
    expect(await verifyUploads(s3, 'b', uploads)).toEqual({ ok: true });
  });

  it('reports a missing object (the seller has not uploaded it)', async () => {
    s3Mock.on(HeadObjectCommand, { Key: 'k1' }).resolves({ ContentLength: 10, ContentType: 'image/png' });
    s3Mock.on(HeadObjectCommand, { Key: 'k2' }).rejects(Object.assign(new Error('nf'), { name: 'NotFound', $metadata: { httpStatusCode: 404 } }));
    expect(await verifyUploads(s3, 'b', uploads)).toEqual({ ok: false, key: 'k2', reason: 'missing' });
  });

  it('rejects an EMPTY object (the old placeholder bug) as a size mismatch', async () => {
    s3Mock.on(HeadObjectCommand).resolves({ ContentLength: 0, ContentType: 'image/png' });
    expect(await verifyUploads(s3, 'b', uploads)).toMatchObject({ ok: false, key: 'k1', reason: 'size_mismatch' });
  });

  it('rejects a different content type, ignoring charset parameters', async () => {
    s3Mock.on(HeadObjectCommand, { Key: 'k1' }).resolves({ ContentLength: 10, ContentType: 'image/png; charset=binary' });
    s3Mock.on(HeadObjectCommand, { Key: 'k2' }).resolves({ ContentLength: 20, ContentType: 'text/html' });
    expect(await verifyUploads(s3, 'b', uploads)).toEqual({ ok: false, key: 'k2', reason: 'type_mismatch' });
  });

  it('propagates other S3 errors instead of treating them as "missing"', async () => {
    s3Mock.on(HeadObjectCommand).rejects(Object.assign(new Error('denied'), { name: 'AccessDenied', $metadata: { httpStatusCode: 403 } }));
    await expect(verifyUploads(s3, 'b', uploads)).rejects.toThrow('denied');
  });
});
