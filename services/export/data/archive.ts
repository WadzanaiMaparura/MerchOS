/**
 * Export history in the exports bucket, under the seller's own prefix:
 *
 *   tenants/<tenantId>/exports/<exportId>/<filename>      the file
 *   tenants/<tenantId>/exports/<exportId>/manifest.json   what it was
 *
 * exportId starts with the UTC time, so ids sort by age. Downloads use
 * short-lived presigned links made on demand (never stored).
 */

import {
  GetObjectCommand,
  ListObjectsV2Command,
  PutObjectCommand,
  S3Client,
  type ListObjectsV2CommandOutput,
} from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import type { ExportChannel } from '../channels/types.js';

export interface ExportManifest {
  exportId: string;
  channel: ExportChannel;
  templateVersion: string;
  format: 'CSV' | 'XLSX';
  filename: string;
  createdAt: string;
  /** Cognito sub of the person who made it. */
  createdBy: string | null;
  productCount: number;
  rowCount: number;
  /** Products left out because they need fixing. */
  excludedCount: number;
  /** When the image links inside the file stop working. */
  imageLinksExpireAt: string;
}

export interface ExportArchivePort {
  save(tenantId: string, manifest: ExportManifest, body: string | Buffer): Promise<void>;
  list(tenantId: string, limit: number): Promise<ExportManifest[]>;
  get(tenantId: string, exportId: string): Promise<ExportManifest | null>;
  downloadUrl(tenantId: string, manifest: ExportManifest, seconds: number): Promise<string>;
}

const CONTENT_TYPES = {
  CSV: 'text/csv; charset=utf-8',
  XLSX: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
} as const;

const prefix = (tenantId: string) => `tenants/${tenantId}/exports/`;
const fileKey = (tenantId: string, m: Pick<ExportManifest, 'exportId' | 'filename'>) =>
  `${prefix(tenantId)}${m.exportId}/${m.filename}`;
const manifestKey = (tenantId: string, exportId: string) => `${prefix(tenantId)}${exportId}/manifest.json`;

/** "20261128T101500Z-3f9a1c" (UTC time first, so ids sort by age). */
export function newExportId(now: Date, random: string): string {
  return `${now.toISOString().replace(/[-:]/g, '').replace(/\.\d+Z$/, 'Z')}-${random}`;
}

/** Ids are generated here; anything else is refused (no path tricks). */
export function isExportId(v: string): boolean {
  return /^\d{8}T\d{6}Z-[a-z0-9]{6,12}$/.test(v);
}

export class S3ExportArchive implements ExportArchivePort {
  constructor(
    private readonly bucket: string,
    private readonly kmsKeyId: string | undefined,
    private readonly s3 = new S3Client({})
  ) {}

  private put(key: string, body: string | Buffer, contentType: string) {
    return this.s3.send(
      new PutObjectCommand({
        Bucket: this.bucket,
        Key: key,
        Body: body,
        ContentType: contentType,
        ...(this.kmsKeyId ? { ServerSideEncryption: 'aws:kms' as const, SSEKMSKeyId: this.kmsKeyId } : {}),
      })
    );
  }

  async save(tenantId: string, manifest: ExportManifest, body: string | Buffer): Promise<void> {
    await this.put(fileKey(tenantId, manifest), body, CONTENT_TYPES[manifest.format]);
    await this.put(manifestKey(tenantId, manifest.exportId), JSON.stringify(manifest), 'application/json');
  }

  async get(tenantId: string, exportId: string): Promise<ExportManifest | null> {
    if (!isExportId(exportId)) return null;
    try {
      const res = await this.s3.send(new GetObjectCommand({ Bucket: this.bucket, Key: manifestKey(tenantId, exportId) }));
      return JSON.parse((await res.Body?.transformToString()) ?? 'null') as ExportManifest | null;
    } catch (e) {
      if ((e as { name?: string }).name === 'NoSuchKey') return null;
      throw e;
    }
  }

  async list(tenantId: string, limit: number): Promise<ExportManifest[]> {
    const ids: string[] = [];
    let token: string | undefined;
    do {
      const res: ListObjectsV2CommandOutput = await this.s3.send(
        new ListObjectsV2Command({ Bucket: this.bucket, Prefix: prefix(tenantId), ...(token ? { ContinuationToken: token } : {}) })
      );
      for (const o of res.Contents ?? []) {
        const m = /\/exports\/([^/]+)\/manifest\.json$/.exec(o.Key ?? '');
        if (m && isExportId(m[1]!)) ids.push(m[1]!);
      }
      token = res.IsTruncated ? res.NextContinuationToken : undefined;
    } while (token);
    const newest = ids.sort().reverse().slice(0, limit);
    const manifests = await Promise.all(newest.map((id) => this.get(tenantId, id)));
    return manifests.filter((m): m is ExportManifest => m !== null);
  }

  downloadUrl(tenantId: string, manifest: ExportManifest, seconds: number): Promise<string> {
    return getSignedUrl(
      this.s3,
      new GetObjectCommand({
        Bucket: this.bucket,
        Key: fileKey(tenantId, manifest),
        ResponseContentDisposition: `attachment; filename="${manifest.filename}"`,
      }),
      { expiresIn: seconds }
    );
  }
}
