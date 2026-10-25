/**
 * Supplier-URL image sourcing (G03).
 *
 * Reuses the Supplier Intelligence HTML extractor to discover product image URLs
 * on a supplier's OWN product page, filters to the supplier's own origin (no
 * third-party / general-web scraping — requirement 6.2/6.4), downloads them into
 * the raw-uploads bucket as Source_Images, and returns the keys so the standard
 * ImageProcessingWorkflow can moderate → hero → variants them.
 *
 * If no usable images are found, the caller flags the product for manual
 * attention rather than failing (requirement 6.5).
 *
 * Requirements: 6.1, 6.2, 6.3, 6.4, 6.5
 */

import { randomUUID } from 'node:crypto';
import { S3Client, PutObjectCommand } from '@aws-sdk/client-s3';
import { SFNClient, StartExecutionCommand } from '@aws-sdk/client-sfn';
import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { DynamoDBDocumentClient, PutCommand } from '@aws-sdk/lib-dynamodb';
// Reuse the supplier-intelligence HTML extractor for image discovery.
import { extractProductsFromHtml } from '../../supplier-intelligence/processors/html-extractor';
import type { ImageJob } from '../types/image.types';

const region = process.env['AWS_REGION'] ?? 'eu-west-1';
const USER_AGENT = 'MerchOS-Crawler/1.0';
const TTL_SECONDS = 365 * 24 * 60 * 60;
/** Cap how many images we pull from one page (requirement 7: max 15 per product). */
const MAX_IMAGES = 15;

let s3Client: S3Client | null = null;
function getS3Client(): S3Client {
  if (!s3Client) s3Client = new S3Client({ region });
  return s3Client;
}
/** Allow test code to inject a mock S3 client. */
export function setS3Client(client: S3Client): void {
  s3Client = client;
}

let sfnClient: SFNClient | null = null;
function getSfnClient(): SFNClient {
  if (!sfnClient) sfnClient = new SFNClient({ region });
  return sfnClient;
}
/** Allow test code to inject a mock Step Functions client. */
export function setSfnClient(client: SFNClient): void {
  sfnClient = client;
}

let ddbDocClient: DynamoDBDocumentClient | null = null;
function getDynamoDocClient(): DynamoDBDocumentClient {
  if (!ddbDocClient) {
    ddbDocClient = DynamoDBDocumentClient.from(new DynamoDBClient({ region }), {
      marshallOptions: { removeUndefinedValues: true },
    });
  }
  return ddbDocClient;
}
/** Allow test code to inject a mock DynamoDB document client. */
export function setDynamoDocClient(client: DynamoDBDocumentClient): void {
  ddbDocClient = client;
}

// ---------------------------------------------------------------------------
// Same-origin filtering (supplier-domain-only guard)
// ---------------------------------------------------------------------------

/**
 * Returns true when `imageUrl` is on the SAME origin as `pageUrl`. Third-party /
 * CDN / arbitrary-web images are rejected — only the supplier's own domain is in
 * scope (requirement 6.2/6.4).
 */
export function isSameOrigin(imageUrl: string, pageUrl: string): boolean {
  try {
    return new URL(imageUrl).origin === new URL(pageUrl).origin;
  } catch {
    return false;
  }
}

/** Extract same-origin, de-duplicated image URLs from a supplier product page. */
export async function discoverSupplierImages(
  html: string,
  pageUrl: string,
): Promise<string[]> {
  // We only want the discovered image URLs — NOT the extractor's own S3
  // download side-effect (we download into raw-uploads ourselves). Pass
  // downloadImages: false so the extractor stays pure here.
  const { products } = await extractProductsFromHtml(html, pageUrl, {
    tenantId: '',
    supplierId: '',
    importJobId: '',
    assetsBucket: '',
    downloadImages: false,
  });
  const all = products.flatMap((p) => p.images ?? []);
  const sameOrigin = all.filter((u) => typeof u === 'string' && u.length > 0 && isSameOrigin(u, pageUrl));
  return Array.from(new Set(sameOrigin)).slice(0, MAX_IMAGES);
}

// ---------------------------------------------------------------------------
// Download helpers
// ---------------------------------------------------------------------------

const MIME_TO_EXT: Record<string, string> = {
  'image/jpeg': 'jpg',
  'image/jpg': 'jpg',
  'image/png': 'png',
  'image/webp': 'webp',
};

async function downloadToRawUploads(
  imageUrl: string,
  bucket: string,
  tenantId: string,
  productId: string,
  fetchFn: typeof fetch,
): Promise<string | null> {
  try {
    const res = await fetchFn(imageUrl, { method: 'GET', headers: { 'User-Agent': USER_AGENT } });
    if (!res.ok) return null;
    const contentType = res.headers.get('content-type') ?? 'image/jpeg';
    const ext = MIME_TO_EXT[contentType.split(';')[0]?.trim() ?? ''] ?? 'jpg';
    const buffer = Buffer.from(await res.arrayBuffer());
    const imageId = randomUUID();
    const s3Key = `images/${tenantId}/${productId}/source/${imageId}.${ext}`;
    await getS3Client().send(
      new PutObjectCommand({
        Bucket: bucket,
        Key: s3Key,
        Body: buffer,
        ContentType: contentType,
        Metadata: { tenantId, productId, imageId, sourceUrl: imageUrl },
      }),
    );
    return s3Key;
  } catch {
    return null;
  }
}

// ---------------------------------------------------------------------------
// Core entry point
// ---------------------------------------------------------------------------

export interface SourceSupplierImagesParams {
  pageUrl: string;
  tenantId: string;
  productId: string;
  rawUploadsBucket: string;
  /** Injectable fetch for testing. */
  fetchFn?: typeof fetch;
}

export interface SourceSupplierImagesResult {
  /** Raw-uploads keys of the downloaded source images. */
  sourceKeys: string[];
  /** Count of same-origin candidate images discovered on the page. */
  imagesFound: number;
}

/**
 * Fetch the supplier page, discover same-origin product images, and download
 * them into raw-uploads as source images. Returns the resulting keys.
 */
export async function sourceSupplierImages(
  params: SourceSupplierImagesParams,
): Promise<SourceSupplierImagesResult> {
  const { pageUrl, tenantId, productId, rawUploadsBucket } = params;
  const fetchFn = params.fetchFn ?? globalThis.fetch;

  const pageRes = await fetchFn(pageUrl, { method: 'GET', headers: { 'User-Agent': USER_AGENT } });
  if (!pageRes.ok) {
    throw new Error(`Failed to fetch supplier page ${pageUrl}: ${pageRes.status}`);
  }
  const html = await pageRes.text();

  const imageUrls = await discoverSupplierImages(html, pageUrl);

  const sourceKeys: string[] = [];
  for (const imageUrl of imageUrls) {
    const key = await downloadToRawUploads(imageUrl, rawUploadsBucket, tenantId, productId, fetchFn);
    if (key) sourceKeys.push(key);
  }

  return { sourceKeys, imagesFound: imageUrls.length };
}

// ---------------------------------------------------------------------------
// Lambda handler — intake entrypoint for SUPPLIER_URL sourcing
// ---------------------------------------------------------------------------

interface SourceUrlEvent {
  tenantId: string;
  productId: string;
  pageUrl: string;
}

/**
 * Sources supplier-own-domain images, creates an Image_Job, and either starts
 * the ImageProcessingWorkflow (when images were found) or records the job as
 * needing manual attention (no images — not a failure, requirement 6.5).
 */
export async function handler(event: SourceUrlEvent): Promise<{
  imageJobId: string;
  status: string;
  imagesFound: number;
}> {
  const { tenantId, productId, pageUrl } = event;
  const rawUploadsBucket = process.env['RAW_UPLOADS_BUCKET'];
  const imageJobsTable = process.env['IMAGE_JOBS_TABLE'];
  const stateMachineArn = process.env['IMAGE_STATE_MACHINE_ARN'];
  const assetsBucket = process.env['ASSETS_BUCKET'];
  if (!rawUploadsBucket || !imageJobsTable || !stateMachineArn || !assetsBucket) {
    throw new Error('Missing required environment variables for supplier-URL sourcing');
  }

  const { sourceKeys, imagesFound } = await sourceSupplierImages({
    pageUrl,
    tenantId,
    productId,
    rawUploadsBucket,
  });

  const imageJobId = randomUUID();
  const now = new Date().toISOString();
  const ttl = Math.floor(Date.now() / 1000) + TTL_SECONDS;
  const hasImages = sourceKeys.length > 0;

  const job: ImageJob = {
    imageJobId,
    tenantId,
    productId,
    sourceMode: 'SUPPLIER_URL',
    // No images found → the job is COMPLETED-with-nothing and the product is
    // flagged for manual attention via reviewRecommended (not FAILED).
    status: hasImages ? 'QUEUED' : 'COMPLETED',
    sourceKeys,
    variants: [],
    reviewRecommended: !hasImages,
    createdAt: now,
    updatedAt: now,
    ttl,
  };

  await getDynamoDocClient().send(
    new PutCommand({
      TableName: imageJobsTable,
      Item: {
        PK: `TENANT#${tenantId}`,
        SK: `IMAGEJOB#${imageJobId}`,
        GSI1PK: `TENANT#${tenantId}#PRODUCT#${productId}`,
        GSI1SK: `IMAGEJOB#CREATED#${now}`,
        ...job,
      },
      ConditionExpression: 'attribute_not_exists(PK)',
    }),
  );

  if (hasImages) {
    await getSfnClient().send(
      new StartExecutionCommand({
        stateMachineArn,
        name: imageJobId,
        input: JSON.stringify({
          tenantId,
          productId,
          imageJobId,
          sourceKeys,
          rawUploadsBucket,
          assetsBucket,
        }),
      }),
    );
  }

  return { imageJobId, status: job.status, imagesFound };
}
