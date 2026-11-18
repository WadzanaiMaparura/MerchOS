/**
 * S3 storage for generated invoice PDFs.
 *
 * Key layout: invoices/<tenantId>/<invoiceNumber>.pdf, in a private bucket that
 * is never served directly. Sellers get a short-lived presigned GET URL, and the
 * tenant id in the path comes from the trusted JWT (never from the request), so
 * one seller cannot name another seller's file.
 */
import { GetObjectCommand, PutObjectCommand, S3Client } from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';

/** How long a download link stays valid. */
export const PRESIGN_SECONDS = 300;

let s3: S3Client | undefined;
function client(): S3Client {
  s3 ??= new S3Client({ region: process.env['AWS_REGION'] ?? 'eu-west-1' });
  return s3;
}

/** Test seam. */
export function setS3Client(c: S3Client | undefined): void {
  s3 = c;
}

function bucket(): string {
  const name = process.env['INVOICE_BUCKET'];
  if (!name) throw new Error('INVOICE_BUCKET is not configured');
  return name;
}

export function invoicePdfKey(tenantId: string, invoiceNumber: string): string {
  // Both parts are generated/validated by us, but never let a separator through.
  const safeTenant = tenantId.replace(/[^A-Za-z0-9_-]/g, '_');
  const safeNumber = invoiceNumber.replace(/[^A-Za-z0-9_-]/g, '_');
  return `invoices/${safeTenant}/${safeNumber}.pdf`;
}

export async function putInvoicePdf(key: string, bytes: Uint8Array): Promise<void> {
  await client().send(
    new PutObjectCommand({
      Bucket: bucket(),
      Key: key,
      Body: bytes,
      ContentType: 'application/pdf',
      // Invoices are accounting records: forbid the browser from sniffing/caching oddly.
      CacheControl: 'private, max-age=0, no-store',
    })
  );
}

/** A presigned URL that downloads the PDF as `<invoiceNumber>.pdf`. */
export async function presignInvoiceDownload(key: string, invoiceNumber: string): Promise<string> {
  return getSignedUrl(
    client(),
    new GetObjectCommand({
      Bucket: bucket(),
      Key: key,
      ResponseContentType: 'application/pdf',
      ResponseContentDisposition: `attachment; filename="${invoiceNumber.replace(/[^A-Za-z0-9_-]/g, '_')}.pdf"`,
    }),
    { expiresIn: PRESIGN_SECONDS }
  );
}
