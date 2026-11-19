/**
 * Direct-to-S3 upload staging for file and image imports.
 *
 * WHY: API Gateway HTTP APIs do not hand the Lambda a raw multipart body, so the
 * old handlers stored an EMPTY placeholder object and queued the import anyway;
 * every file import ran on an empty file. Now:
 *   1. the trigger handler creates the ImportJob as AWAITING_UPLOAD and returns a
 *      short-lived presigned PUT URL per file (nothing is queued yet);
 *   2. the browser uploads straight to S3 (large files never pass through the API);
 *   3. POST /imports/{importJobId}/start verifies every object really exists with
 *      the declared size and type, and only then queues the import.
 *
 * The signed URL binds Content-Type and Content-Length, so S3 rejects an upload of
 * a different type or size than the one the seller declared and we validated.
 */
import { HeadObjectCommand, PutObjectCommand, type S3Client } from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';

/** How long a seller has to upload after requesting the import. */
export const UPLOAD_URL_TTL_SECONDS = 15 * 60;

const MAX_NAME_LENGTH = 120;

/**
 * Makes a user-supplied file name safe to use as the last segment of an S3 key:
 * keeps only the base name (no directories, so no '..' or prefix tricks), allows
 * letters, digits, '.', '_' and '-', collapses everything else to '_', and bounds
 * the length while keeping the extension. Never returns an empty name.
 */
export function sanitizeFileName(raw: string): string {
  const base = raw.split(/[\\/]/).pop() ?? '';
  let name = base
    .normalize('NFKD')
    .replace(/[^\w.-]+/g, '_')
    .replace(/_+/g, '_')
    .replace(/^[._]+/, '') // no hidden files / leading dots
    .replace(/\.{2,}/g, '.');
  if (name.length > MAX_NAME_LENGTH) {
    const dot = name.lastIndexOf('.');
    const ext = dot > 0 && name.length - dot <= 10 ? name.slice(dot) : '';
    name = name.slice(0, MAX_NAME_LENGTH - ext.length) + ext;
  }
  return name || 'upload';
}

export interface PendingUpload {
  /** S3 key the browser must upload to. */
  key: string;
  contentType: string;
  sizeBytes: number;
  /** Original name the seller chose (for display only, never used as a key). */
  originalFileName: string;
}

export interface UploadInstruction {
  key: string;
  url: string;
  method: 'PUT';
  /** Headers the browser MUST send unchanged (they are part of the signature). */
  headers: { 'Content-Type': string };
  expiresAt: string;
}

export async function presignUpload(
  s3: S3Client,
  bucket: string,
  upload: PendingUpload,
  metadata: Record<string, string>,
  now: Date = new Date()
): Promise<UploadInstruction> {
  const url = await getSignedUrl(
    s3,
    new PutObjectCommand({
      Bucket: bucket,
      Key: upload.key,
      ContentType: upload.contentType,
      ContentLength: upload.sizeBytes,
      Metadata: metadata,
    }),
    {
      expiresIn: UPLOAD_URL_TTL_SECONDS,
      // Content-Type is NOT signed by default, which would let a different type be
      // uploaded than the one declared. Signing it makes S3 reject any mismatch.
      // (Content-Length is signed by default; x-amz-meta-* travel as query params.)
      signableHeaders: new Set(['content-type']),
    }
  );
  return {
    key: upload.key,
    url,
    method: 'PUT',
    headers: { 'Content-Type': upload.contentType },
    expiresAt: new Date(now.getTime() + UPLOAD_URL_TTL_SECONDS * 1000).toISOString(),
  };
}

export type UploadCheck =
  | { ok: true }
  | { ok: false; key: string; reason: 'missing' | 'size_mismatch' | 'type_mismatch' };

/** Confirms every expected object is in S3 with the declared size and type. */
export async function verifyUploads(
  s3: S3Client,
  bucket: string,
  uploads: PendingUpload[]
): Promise<UploadCheck> {
  for (const u of uploads) {
    let head;
    try {
      head = await s3.send(new HeadObjectCommand({ Bucket: bucket, Key: u.key }));
    } catch (error) {
      const name = (error as { name?: string }).name;
      const status = (error as { $metadata?: { httpStatusCode?: number } }).$metadata?.httpStatusCode;
      if (name === 'NotFound' || name === 'NoSuchKey' || status === 404) {
        return { ok: false, key: u.key, reason: 'missing' };
      }
      throw error;
    }
    if (head.ContentLength !== u.sizeBytes) return { ok: false, key: u.key, reason: 'size_mismatch' };
    if ((head.ContentType ?? '').split(';')[0]!.trim() !== u.contentType) {
      return { ok: false, key: u.key, reason: 'type_mismatch' };
    }
  }
  return { ok: true };
}
