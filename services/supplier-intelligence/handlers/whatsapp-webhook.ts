/**
 * WhatsApp Webhook Lambda handler for POST /webhooks/whatsapp.
 *
 * Receives incoming WhatsApp Cloud API webhook notifications containing
 * image messages. Validates the HMAC signature (X-Hub-Signature-256),
 * extracts image media IDs from the payload, downloads images via the
 * WhatsApp Media API, stores them in S3, and enqueues an import job
 * for OCR processing via the same image pipeline.
 *
 * This handler does NOT use JWT auth — it uses HMAC signature verification
 * against the WhatsApp App Secret.
 *
 * Requirements: 3.2
 */

import crypto from 'node:crypto';
import type { APIGatewayProxyEventV2, APIGatewayProxyResultV2 } from 'aws-lambda';
import { S3Client, PutObjectCommand } from '@aws-sdk/client-s3';
import { SQSClient, SendMessageCommand } from '@aws-sdk/client-sqs';
import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { DynamoDBDocumentClient, PutCommand } from '@aws-sdk/lib-dynamodb';

import type { ImportJob, ImportJobStatus, SourceType } from '../types';
import { logger } from '../../shared/middleware/powertools';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/** WhatsApp Cloud API webhook message payload types. */
interface WhatsAppWebhookPayload {
  object: string;
  entry: WhatsAppEntry[];
}

interface WhatsAppEntry {
  id: string;
  changes: WhatsAppChange[];
}

interface WhatsAppChange {
  value: WhatsAppChangeValue;
  field: string;
}

interface WhatsAppChangeValue {
  messaging_product: string;
  metadata: {
    display_phone_number: string;
    phone_number_id: string;
  };
  contacts?: WhatsAppContact[];
  messages?: WhatsAppMessage[];
}

interface WhatsAppContact {
  profile: { name: string };
  wa_id: string;
}

interface WhatsAppMessage {
  from: string;
  id: string;
  timestamp: string;
  type: string;
  image?: WhatsAppMediaObject;
}

interface WhatsAppMediaObject {
  id: string;
  mime_type: string;
  sha256: string;
  caption?: string;
}

/** Image entry extracted from the webhook payload ready for processing. */
interface ExtractedImage {
  mediaId: string;
  mimeType: string;
  sha256: string;
  caption?: string;
  senderPhoneNumber: string;
}

// ---------------------------------------------------------------------------
// AWS SDK Clients (singleton for connection reuse across invocations)
// ---------------------------------------------------------------------------

const region = process.env['AWS_REGION'] ?? 'af-south-1';

let s3Client: S3Client | null = null;
function getS3Client(): S3Client {
  if (!s3Client) {
    s3Client = new S3Client({ region });
  }
  return s3Client;
}

let sqsClient: SQSClient | null = null;
function getSqsClient(): SQSClient {
  if (!sqsClient) {
    sqsClient = new SQSClient({ region });
  }
  return sqsClient;
}

let ddbDocClient: DynamoDBDocumentClient | null = null;
function getDynamoDocClient(): DynamoDBDocumentClient {
  if (!ddbDocClient) {
    const client = new DynamoDBClient({ region });
    ddbDocClient = DynamoDBDocumentClient.from(client, {
      marshallOptions: { removeUndefinedValues: true },
    });
  }
  return ddbDocClient;
}

// ---------------------------------------------------------------------------
// HMAC Signature Verification
// ---------------------------------------------------------------------------

/**
 * Validates the X-Hub-Signature-256 header against the raw request body
 * using the WhatsApp App Secret as the HMAC key.
 *
 * The signature header format is: `sha256=<hex-digest>`
 */
export function verifyHmacSignature(rawBody: string, signatureHeader: string, appSecret: string): boolean {
  if (!signatureHeader || !signatureHeader.startsWith('sha256=')) {
    return false;
  }

  const expectedSignature = signatureHeader.slice('sha256='.length);
  const computedSignature = crypto
    .createHmac('sha256', appSecret)
    .update(rawBody, 'utf8')
    .digest('hex');

  // Use timing-safe comparison to prevent timing attacks
  try {
    return crypto.timingSafeEqual(
      Buffer.from(computedSignature, 'hex'),
      Buffer.from(expectedSignature, 'hex'),
    );
  } catch {
    // If buffers have different length, timingSafeEqual throws
    return false;
  }
}

// ---------------------------------------------------------------------------
// Payload Extraction
// ---------------------------------------------------------------------------

/**
 * Extracts image entries from the WhatsApp webhook payload.
 * Only processes messages of type "image".
 */
export function extractImagesFromPayload(payload: WhatsAppWebhookPayload): ExtractedImage[] {
  const images: ExtractedImage[] = [];

  for (const entry of payload.entry ?? []) {
    for (const change of entry.changes ?? []) {
      const messages = change.value?.messages ?? [];
      for (const message of messages) {
        if (message.type === 'image' && message.image) {
          images.push({
            mediaId: message.image.id,
            mimeType: message.image.mime_type,
            sha256: message.image.sha256,
            caption: message.image.caption,
            senderPhoneNumber: message.from,
          });
        }
      }
    }
  }

  return images;
}

// ---------------------------------------------------------------------------
// WhatsApp Media Download
// ---------------------------------------------------------------------------

/**
 * Downloads an image from the WhatsApp Media API.
 *
 * Step 1: Fetch the media URL using the media ID.
 * Step 2: Download the actual image binary from the returned URL.
 */
async function downloadWhatsAppMedia(
  mediaId: string,
  accessToken: string,
): Promise<{ buffer: Buffer; contentType: string }> {
  // Step 1: Get media URL from WhatsApp API
  const mediaInfoResponse = await fetch(
    `https://graph.facebook.com/v18.0/${mediaId}`,
    {
      headers: { Authorization: `Bearer ${accessToken}` },
    },
  );

  if (!mediaInfoResponse.ok) {
    throw new Error(
      `Failed to get media info for ${mediaId}: ${mediaInfoResponse.status} ${mediaInfoResponse.statusText}`,
    );
  }

  const mediaInfo = (await mediaInfoResponse.json()) as { url: string; mime_type: string };

  // Step 2: Download the actual media file
  const mediaResponse = await fetch(mediaInfo.url, {
    headers: { Authorization: `Bearer ${accessToken}` },
  });

  if (!mediaResponse.ok) {
    throw new Error(
      `Failed to download media ${mediaId}: ${mediaResponse.status} ${mediaResponse.statusText}`,
    );
  }

  const arrayBuffer = await mediaResponse.arrayBuffer();
  return {
    buffer: Buffer.from(arrayBuffer),
    contentType: mediaInfo.mime_type,
  };
}

// ---------------------------------------------------------------------------
// File Extension Helper
// ---------------------------------------------------------------------------

function getExtensionFromMimeType(mimeType: string): string {
  const mimeMap: Record<string, string> = {
    'image/jpeg': 'jpg',
    'image/png': 'png',
    'image/webp': 'webp',
    'image/gif': 'gif',
  };
  return mimeMap[mimeType] ?? 'jpg';
}

// ---------------------------------------------------------------------------
// Handler
// ---------------------------------------------------------------------------

/**
 * WhatsApp webhook handler:
 * 1. Handle webhook verification (GET requests for hub.challenge)
 * 2. Validate HMAC signature on POST requests
 * 3. Extract image media IDs from the WhatsApp message payload
 * 4. Download images via WhatsApp Media API
 * 5. Store downloaded images in S3
 * 6. Create ImportJob record in DynamoDB
 * 7. Enqueue for OCR processing via the import queue
 */
export async function handler(event: APIGatewayProxyEventV2): Promise<APIGatewayProxyResultV2> {
  // Handle webhook verification challenge (GET request from WhatsApp)
  if (event.requestContext.http.method === 'GET') {
    return handleVerificationChallenge(event);
  }

  // POST request — process incoming webhook notification
  const appSecret = process.env['WHATSAPP_APP_SECRET'];
  const accessToken = process.env['WHATSAPP_ACCESS_TOKEN'];
  const rawUploadsBucket = process.env['RAW_UPLOADS_BUCKET'];
  const importQueueUrl = process.env['IMPORT_QUEUE_URL'];
  const importJobsTable = process.env['IMPORT_JOBS_TABLE'];
  const defaultTenantId = process.env['WHATSAPP_DEFAULT_TENANT_ID'];
  const defaultSupplierId = process.env['WHATSAPP_DEFAULT_SUPPLIER_ID'];

  if (!appSecret || !accessToken || !rawUploadsBucket || !importQueueUrl || !importJobsTable) {
    logger.error('Missing required environment variables for WhatsApp webhook');
    return {
      statusCode: 500,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        error: { code: 'INTERNAL_ERROR', message: 'Service misconfigured' },
      }),
    };
  }

  // Step 1: Validate HMAC signature
  const rawBody = event.body ?? '';
  const signatureHeader = event.headers['x-hub-signature-256'] ?? '';

  if (!verifyHmacSignature(rawBody, signatureHeader, appSecret)) {
    logger.warn('Invalid HMAC signature on WhatsApp webhook');
    return {
      statusCode: 401,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        error: { code: 'INVALID_SIGNATURE', message: 'Webhook signature verification failed' },
      }),
    };
  }

  // Step 2: Parse payload and extract images
  let payload: WhatsAppWebhookPayload;
  try {
    payload = JSON.parse(rawBody) as WhatsAppWebhookPayload;
  } catch {
    logger.warn('Invalid JSON body in WhatsApp webhook');
    return {
      statusCode: 400,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        error: { code: 'INVALID_PAYLOAD', message: 'Request body is not valid JSON' },
      }),
    };
  }

  const extractedImages = extractImagesFromPayload(payload);

  if (extractedImages.length === 0) {
    // No images to process — acknowledge the webhook
    logger.info('WhatsApp webhook received with no image messages');
    return { statusCode: 200, body: 'OK' };
  }

  // Use configured tenant/supplier mapping or defaults
  const tenantId = defaultTenantId ?? 'default-tenant';
  const supplierId = defaultSupplierId ?? 'whatsapp-supplier';
  const importJobId = crypto.randomUUID();
  const sourceType: SourceType = 'IMAGE';
  const now = new Date().toISOString();
  const ttl = Math.floor(Date.now() / 1000) + 365 * 24 * 60 * 60; // 365 days
  const s3Prefix = `suppliers/${tenantId}/${supplierId}/images/${importJobId}`;

  logger.info('Processing WhatsApp image webhook', {
    tenantId,
    supplierId,
    importJobId,
    imageCount: extractedImages.length,
    s3Prefix,
  });

  try {
    // Step 3: Download images and store in S3
    const storedImages: Array<{
      fileName: string;
      contentType: string;
      fileSizeBytes: number;
      s3Key: string;
    }> = [];

    for (const image of extractedImages) {
      const { buffer, contentType } = await downloadWhatsAppMedia(image.mediaId, accessToken);
      const extension = getExtensionFromMimeType(image.mimeType);
      const fileName = `${image.mediaId}.${extension}`;
      const s3Key = `${s3Prefix}/${fileName}`;

      await getS3Client().send(
        new PutObjectCommand({
          Bucket: rawUploadsBucket,
          Key: s3Key,
          ContentType: contentType,
          Body: buffer,
          Metadata: {
            tenantId,
            supplierId,
            importJobId,
            mediaId: image.mediaId,
            senderPhoneNumber: image.senderPhoneNumber,
            ...(image.caption ? { caption: image.caption } : {}),
          },
        }),
      );

      storedImages.push({
        fileName,
        contentType,
        fileSizeBytes: buffer.length,
        s3Key,
      });

      logger.info('Image downloaded and stored in S3', {
        mediaId: image.mediaId,
        s3Key,
        fileSizeBytes: buffer.length,
      });
    }

    // Step 4: Create ImportJob record in DynamoDB with status QUEUED
    const importJob: ImportJob = {
      importJobId,
      tenantId,
      supplierId,
      sourceType,
      sourceReference: s3Prefix,
      status: 'QUEUED' as ImportJobStatus,
      errors: [],
      createdAt: now,
      ttl,
    };

    await getDynamoDocClient().send(
      new PutCommand({
        TableName: importJobsTable,
        Item: {
          PK: `TENANT#${tenantId}`,
          SK: `IMPORT#${importJobId}`,
          GSI1PK: `TENANT#${tenantId}#SUPPLIER#${supplierId}`,
          GSI1SK: `IMPORT#CREATED#${now}`,
          GSI2PK: `TENANT#${tenantId}#STATUS#QUEUED`,
          GSI2SK: `IMPORT#CREATED#${now}`,
          ...importJob,
        },
      }),
    );

    logger.info('ImportJob record created in DynamoDB', { importJobId, status: 'QUEUED' });

    // Step 5: Send SQS message to FIFO queue with MessageGroupId=tenantId
    await getSqsClient().send(
      new SendMessageCommand({
        QueueUrl: importQueueUrl,
        MessageGroupId: tenantId,
        MessageDeduplicationId: importJobId,
        MessageBody: JSON.stringify({
          importJobId,
          tenantId,
          supplierId,
          sourceType,
          sourceReference: s3Prefix,
          images: storedImages,
        }),
      }),
    );

    logger.info('SQS message sent to import queue', {
      importJobId,
      messageGroupId: tenantId,
      imageCount: storedImages.length,
    });

    // Return 200 to acknowledge webhook delivery
    return { statusCode: 200, body: 'OK' };
  } catch (error) {
    logger.error('Failed to process WhatsApp image webhook', {
      error: error instanceof Error ? error.message : String(error),
      importJobId,
      tenantId,
      supplierId,
    });

    return {
      statusCode: 500,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        error: { code: 'WEBHOOK_PROCESSING_FAILED', message: 'Failed to process webhook images' },
      }),
    };
  }
}

// ---------------------------------------------------------------------------
// Webhook Verification Challenge
// ---------------------------------------------------------------------------

/**
 * Handles the WhatsApp webhook verification challenge (GET request).
 * WhatsApp sends a GET request with hub.mode, hub.verify_token, and hub.challenge
 * query parameters. We verify the token and return the challenge value.
 */
function handleVerificationChallenge(event: APIGatewayProxyEventV2): APIGatewayProxyResultV2 {
  const mode = event.queryStringParameters?.['hub.mode'];
  const token = event.queryStringParameters?.['hub.verify_token'];
  const challenge = event.queryStringParameters?.['hub.challenge'];
  const verifyToken = process.env['WHATSAPP_VERIFY_TOKEN'];

  if (mode === 'subscribe' && token === verifyToken) {
    logger.info('WhatsApp webhook verification successful');
    return {
      statusCode: 200,
      headers: { 'Content-Type': 'text/plain' },
      body: challenge ?? '',
    };
  }

  logger.warn('WhatsApp webhook verification failed', { mode, tokenMatch: token === verifyToken });
  return {
    statusCode: 403,
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      error: { code: 'VERIFICATION_FAILED', message: 'Webhook verification failed' },
    }),
  };
}
