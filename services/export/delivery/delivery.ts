/**
 * Delivery layer (architecture §6.1 stage 7).
 *
 * Persists a generated export to the exports S3 bucket and returns a signed,
 * time-limited download URL. The engine stays pure: delivery is a separate,
 * injectable port so nothing in the generation path depends on AWS.
 */

export interface DeliveryArtifact {
  /** S3 object key the export was/will be written to. */
  key: string;
  /** Signed download URL (time-limited). */
  downloadUrl: string;
  /** URL expiry in seconds. */
  expiresInSeconds: number;
  bucket: string;
}

export interface PutObjectArgs {
  key: string;
  body: string | Buffer;
  contentType: string;
}

/** Minimal S3 port so the service can be unit-tested without AWS. */
export interface ObjectStoragePort {
  putObject(args: PutObjectArgs): Promise<void>;
  getSignedDownloadUrl(key: string, expiresInSeconds: number): Promise<string>;
  readonly bucket: string;
}

const CSV_CONTENT_TYPE = 'text/csv; charset=utf-8';
const XLSX_CONTENT_TYPE =
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';

export interface DeliverOptions {
  /** Tenant for key scoping (exports are tenant-isolated). */
  tenantId: string;
  /** Logical export id (for traceability). */
  exportId: string;
  filename: string;
  format: 'CSV' | 'XLSX';
  body: string | Buffer;
  /** Signed URL lifetime; default 15 minutes. */
  expiresInSeconds?: number;
}

/**
 * Write an export artifact to object storage and return a signed URL.
 * Key layout: tenants/{tenantId}/exports/{exportId}/{filename}
 */
export async function deliverExport(
  storage: ObjectStoragePort,
  options: DeliverOptions
): Promise<DeliveryArtifact> {
  const key = `tenants/${options.tenantId}/exports/${options.exportId}/${options.filename}`;
  const contentType = options.format === 'XLSX' ? XLSX_CONTENT_TYPE : CSV_CONTENT_TYPE;
  const expiresInSeconds = options.expiresInSeconds ?? 900;

  await storage.putObject({ key, body: options.body, contentType });
  const downloadUrl = await storage.getSignedDownloadUrl(key, expiresInSeconds);

  return { key, downloadUrl, expiresInSeconds, bucket: storage.bucket };
}
