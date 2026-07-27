/**
 * Image Processor Lambda — OCR text extraction from product images using AWS Textract.
 * Requirements: 3.1, 3.3, 3.4
 *
 * Responsibilities:
 * - Call AWS Textract detectDocumentText for each uploaded image
 * - Extract product name, price, SKU from OCR response with confidence scores
 * - Store original images in assets S3 bucket, link as hero image on Product_Record
 * - Flag fields with confidence < 0.70 for manual review
 */

import {
  TextractClient,
  DetectDocumentTextCommand,
  type Block,
} from '@aws-sdk/client-textract';
import { S3Client, CopyObjectCommand } from '@aws-sdk/client-s3';
import type { ParsedRecord } from './file-parser';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/** Confidence threshold below which a field is flagged for manual review. */
export const OCR_CONFIDENCE_THRESHOLD = 0.70;

/** A single image reference to be processed. */
export interface ImageInput {
  /** S3 key of the uploaded image in the raw uploads bucket */
  s3Key: string;
  /** S3 bucket where the image is currently stored */
  bucket: string;
  /** Original file name of the image */
  fileName: string;
  /** MIME content type (e.g. image/jpeg, image/png) */
  contentType: string;
}

/** Input parameters for the image processor function. */
export interface ImageProcessorInput {
  images: ImageInput[];
  tenantId: string;
  supplierId: string;
  importJobId: string;
  /** Destination assets bucket for hero images */
  assetsBucket: string;
}

/** Per-field OCR confidence scores. */
export interface OcrFieldConfidence {
  title?: number;
  price?: number;
  sku?: number;
}

/** Extended parsed record with OCR-specific metadata. */
export interface OcrParsedRecord extends ParsedRecord {
  /** Per-field confidence scores from OCR extraction */
  ocrConfidence: OcrFieldConfidence;
  /** Overall flag indicating manual review is needed */
  flaggedForReview: boolean;
  /** Fields that have been flagged for manual review (confidence < 0.70) */
  flaggedFields: string[];
  /** S3 key of the hero image in the assets bucket */
  heroImageKey?: string;
}

/** Result of the image processing operation. */
export interface ImageProcessorResult {
  records: OcrParsedRecord[];
  processedCount: number;
  failedCount: number;
  flaggedForReviewCount: number;
}

// ---------------------------------------------------------------------------
// Extracted Text Block (internal)
// ---------------------------------------------------------------------------

interface ExtractedLine {
  text: string;
  confidence: number;
}

// ---------------------------------------------------------------------------
// AWS Clients (lazy-initialised for Lambda reuse)
// ---------------------------------------------------------------------------

let textractClient: TextractClient | undefined;
let s3Client: S3Client | undefined;

function getTextractClient(): TextractClient {
  if (!textractClient) {
    textractClient = new TextractClient({});
  }
  return textractClient;
}

function getS3Client(): S3Client {
  if (!s3Client) {
    s3Client = new S3Client({});
  }
  return s3Client;
}

/**
 * Allow test code to inject mock clients.
 */
export function setClients(options: { textract?: TextractClient; s3?: S3Client }): void {
  if (options.textract) textractClient = options.textract;
  if (options.s3) s3Client = options.s3;
}

/**
 * Reset clients (useful for testing teardown).
 */
export function resetClients(): void {
  textractClient = undefined;
  s3Client = undefined;
}

// ---------------------------------------------------------------------------
// Core Processing Logic
// ---------------------------------------------------------------------------

/**
 * Process a batch of images: run OCR via Textract, extract product fields,
 * copy images to assets bucket, and return parsed records.
 */
export async function processImages(input: ImageProcessorInput): Promise<ImageProcessorResult> {
  const { images, tenantId, supplierId, importJobId, assetsBucket } = input;

  const records: OcrParsedRecord[] = [];
  let processedCount = 0;
  let failedCount = 0;
  let flaggedForReviewCount = 0;

  for (let i = 0; i < images.length; i++) {
    const image = images[i]!;
    try {
      // 1. Call Textract to detect text in the image
      const extractedLines = await detectText(image.bucket, image.s3Key);

      // 2. Parse OCR response to extract product fields with confidence
      const { title, price, sku, confidence } = extractProductFields(extractedLines);

      // 3. Copy image to assets bucket as hero image
      const heroImageKey = `assets/${tenantId}/${supplierId}/${importJobId}/${image.fileName}`;
      await copyImageToAssets(image.bucket, image.s3Key, assetsBucket, heroImageKey);

      // 4. Determine which fields are flagged for review
      const flaggedFields = determineFlaggedFields(confidence);
      const flaggedForReview = flaggedFields.length > 0;

      if (flaggedForReview) {
        flaggedForReviewCount++;
      }

      // 5. Build the parsed record
      const record: OcrParsedRecord = {
        title,
        sku,
        price,
        images: [heroImageKey],
        sourceRowIndex: i + 1,
        ocrConfidence: confidence,
        flaggedForReview,
        flaggedFields,
        heroImageKey,
      };

      records.push(record);
      processedCount++;
    } catch (_error) {
      // If an individual image fails, increment failed count and continue
      failedCount++;
    }
  }

  return {
    records,
    processedCount,
    failedCount,
    flaggedForReviewCount,
  };
}

// ---------------------------------------------------------------------------
// Textract Integration
// ---------------------------------------------------------------------------

/**
 * Call AWS Textract detectDocumentText for the given S3 object.
 * Returns an array of extracted lines with their confidence scores.
 */
async function detectText(bucket: string, s3Key: string): Promise<ExtractedLine[]> {
  const client = getTextractClient();

  const command = new DetectDocumentTextCommand({
    Document: {
      S3Object: {
        Bucket: bucket,
        Name: s3Key,
      },
    },
  });

  const response = await client.send(command);
  const blocks: Block[] = response.Blocks ?? [];

  // Extract LINE-type blocks (which contain readable text lines)
  const lines: ExtractedLine[] = blocks
    .filter((block) => block.BlockType === 'LINE' && block.Text)
    .map((block) => ({
      text: block.Text!,
      confidence: (block.Confidence ?? 0) / 100, // Textract returns 0-100, normalise to 0-1
    }));

  return lines;
}

// ---------------------------------------------------------------------------
// Field Extraction Heuristics
// ---------------------------------------------------------------------------

/** Regex patterns for price detection. */
const PRICE_PATTERNS = [
  // Currency symbol followed by number: $12.99, €150, £9.99, ¥1200
  /(?:[$€£¥])\s*[\d,]+(?:\.\d{1,2})?/,
  // Number followed by currency code: 12.99 USD, 150 EUR
  /[\d,]+(?:\.\d{1,2})?\s*(?:USD|EUR|GBP|JPY|AUD|CAD)/i,
  // Standalone price-like numbers with decimal: 12.99, 1,200.00
  /^\d{1,3}(?:,\d{3})*\.\d{2}$/,
  // Price label patterns: "Price: $12.99", "MRP: 150"
  /(?:price|mrp|cost|amount)\s*[:\-]?\s*[$€£¥]?\s*[\d,]+(?:\.\d{1,2})?/i,
];

/** Regex patterns for SKU detection. */
const SKU_PATTERNS = [
  // Explicit SKU label: "SKU: ABC-123", "SKU#12345"
  /(?:sku|item\s*(?:code|no|#)|part\s*(?:no|#)|article\s*(?:no|#)|product\s*(?:code|#))\s*[:\-#]?\s*([A-Z0-9][\w\-]{2,20})/i,
  // Standalone alphanumeric code: "ABC-1234", "XYZ_567"
  /^[A-Z]{2,5}[\-_][A-Z0-9\-_]{2,15}$/,
  // UPC/EAN barcode patterns (8-14 digits)
  /^\d{8,14}$/,
];

interface ExtractedFields {
  title?: string;
  price?: string;
  sku?: string;
  confidence: OcrFieldConfidence;
}

/**
 * Apply heuristics to identify product name, price, and SKU from OCR text lines.
 * Assigns the confidence score from the source line to each extracted field.
 */
export function extractProductFields(lines: ExtractedLine[]): ExtractedFields {
  const confidence: OcrFieldConfidence = {};
  let title: string | undefined;
  let price: string | undefined;
  let sku: string | undefined;

  // Track which lines have been assigned to specific fields
  const assignedIndices = new Set<number>();

  // Pass 1: Extract price (most distinctive pattern)
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]!;
    for (const pattern of PRICE_PATTERNS) {
      const match = line.text.match(pattern);
      if (match) {
        price = match[0];
        confidence.price = line.confidence;
        assignedIndices.add(i);
        break;
      }
    }
    if (price) break;
  }

  // Pass 2: Extract SKU
  for (let i = 0; i < lines.length; i++) {
    if (assignedIndices.has(i)) continue;
    const line = lines[i]!;
    for (const pattern of SKU_PATTERNS) {
      const match = line.text.match(pattern);
      if (match) {
        // Use the captured group if available, otherwise use the full match
        sku = match[1] ?? match[0];
        confidence.sku = line.confidence;
        assignedIndices.add(i);
        break;
      }
    }
    if (sku) break;
  }

  // Pass 3: Extract title (longest unassigned line that looks like a product name)
  // Product names tend to be the longest descriptive text that isn't a price or SKU
  let bestTitleScore = -1;
  let bestTitleIndex = -1;

  for (let i = 0; i < lines.length; i++) {
    if (assignedIndices.has(i)) continue;
    const line = lines[i]!;
    const text = line.text.trim();

    // Skip very short lines (unlikely to be product names)
    if (text.length < 3) continue;

    // Skip lines that are purely numeric
    if (/^\d+$/.test(text)) continue;

    // Score: prefer longer text with higher confidence, but not too long (likely descriptions)
    const lengthScore = Math.min(text.length, 80) / 80; // Normalise length, cap at 80
    const score = lengthScore * 0.6 + line.confidence * 0.4;

    if (score > bestTitleScore) {
      bestTitleScore = score;
      bestTitleIndex = i;
    }
  }

  if (bestTitleIndex >= 0) {
    const line = lines[bestTitleIndex]!;
    title = line.text.trim();
    confidence.title = line.confidence;
    assignedIndices.add(bestTitleIndex);
  }

  return { title, price, sku, confidence };
}

// ---------------------------------------------------------------------------
// Confidence Thresholding
// ---------------------------------------------------------------------------

/**
 * Determine which extracted fields should be flagged for manual review
 * based on the OCR_CONFIDENCE_THRESHOLD (0.70).
 *
 * A field is flagged if its confidence score is below the threshold.
 * Fields that were not extracted (no confidence score) are not flagged.
 */
export function determineFlaggedFields(confidence: OcrFieldConfidence): string[] {
  const flagged: string[] = [];

  if (confidence.title !== undefined && confidence.title < OCR_CONFIDENCE_THRESHOLD) {
    flagged.push('title');
  }
  if (confidence.price !== undefined && confidence.price < OCR_CONFIDENCE_THRESHOLD) {
    flagged.push('price');
  }
  if (confidence.sku !== undefined && confidence.sku < OCR_CONFIDENCE_THRESHOLD) {
    flagged.push('sku');
  }

  return flagged;
}

// ---------------------------------------------------------------------------
// S3 Image Copy
// ---------------------------------------------------------------------------

/**
 * Copy an image from the source bucket to the assets bucket.
 */
async function copyImageToAssets(
  sourceBucket: string,
  sourceKey: string,
  destinationBucket: string,
  destinationKey: string
): Promise<void> {
  const client = getS3Client();

  const command = new CopyObjectCommand({
    CopySource: `${sourceBucket}/${sourceKey}`,
    Bucket: destinationBucket,
    Key: destinationKey,
  });

  await client.send(command);
}
