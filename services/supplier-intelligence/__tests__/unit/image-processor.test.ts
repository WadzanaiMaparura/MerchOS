/**
 * Unit tests for the image processor (OCR extraction and confidence thresholding).
 * Requirements: 3.1, 3.3, 3.4
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { mockClient } from 'aws-sdk-client-mock';
import { TextractClient, DetectDocumentTextCommand } from '@aws-sdk/client-textract';
import { S3Client, CopyObjectCommand } from '@aws-sdk/client-s3';
import {
  processImages,
  extractProductFields,
  determineFlaggedFields,
  OCR_CONFIDENCE_THRESHOLD,
  setClients,
  resetClients,
  type ImageProcessorInput,
  type OcrFieldConfidence,
} from '../../processors/image-processor';

// ---------------------------------------------------------------------------
// Mocks
// ---------------------------------------------------------------------------

const textractMock = mockClient(TextractClient);
const s3Mock = mockClient(S3Client);

beforeEach(() => {
  textractMock.reset();
  s3Mock.reset();

  // Inject mocked clients
  setClients({
    textract: textractMock as unknown as TextractClient,
    s3: s3Mock as unknown as S3Client,
  });
});

afterEach(() => {
  resetClients();
});

// ---------------------------------------------------------------------------
// extractProductFields
// ---------------------------------------------------------------------------

describe('extractProductFields', () => {
  it('extracts title from the longest descriptive line', () => {
    const lines = [
      { text: 'Premium Wireless Bluetooth Headphones', confidence: 0.95 },
      { text: '$49.99', confidence: 0.88 },
      { text: 'SKU: WBH-2024', confidence: 0.91 },
    ];

    const result = extractProductFields(lines);

    expect(result.title).toBe('Premium Wireless Bluetooth Headphones');
    expect(result.confidence.title).toBe(0.95);
  });

  it('extracts price with dollar sign', () => {
    const lines = [
      { text: 'Widget Pro Max', confidence: 0.92 },
      { text: '$129.99', confidence: 0.85 },
    ];

    const result = extractProductFields(lines);

    expect(result.price).toBe('$129.99');
    expect(result.confidence.price).toBe(0.85);
  });

  it('extracts price with euro sign', () => {
    const lines = [
      { text: 'Leather Wallet', confidence: 0.90 },
      { text: '€39.99', confidence: 0.78 },
    ];

    const result = extractProductFields(lines);

    expect(result.price).toBe('€39.99');
    expect(result.confidence.price).toBe(0.78);
  });

  it('extracts SKU with explicit label', () => {
    const lines = [
      { text: 'Sports Watch', confidence: 0.93 },
      { text: 'SKU: SW-1234', confidence: 0.87 },
      { text: '$199.00', confidence: 0.91 },
    ];

    const result = extractProductFields(lines);

    expect(result.sku).toBe('SW-1234');
    expect(result.confidence.sku).toBe(0.87);
  });

  it('extracts SKU from standalone alphanumeric code', () => {
    const lines = [
      { text: 'ABC-12345', confidence: 0.80 },
      { text: 'Running Shoes', confidence: 0.92 },
      { text: '$89.99', confidence: 0.95 },
    ];

    const result = extractProductFields(lines);

    expect(result.sku).toBe('ABC-12345');
    expect(result.confidence.sku).toBe(0.80);
  });

  it('handles empty lines array', () => {
    const result = extractProductFields([]);

    expect(result.title).toBeUndefined();
    expect(result.price).toBeUndefined();
    expect(result.sku).toBeUndefined();
    expect(result.confidence).toEqual({});
  });

  it('handles lines with no recognisable patterns', () => {
    const lines = [
      { text: 'Some random text about this product', confidence: 0.75 },
      { text: 'Another line of description', confidence: 0.80 },
    ];

    const result = extractProductFields(lines);

    // Should still pick the best title candidate
    expect(result.title).toBeDefined();
    expect(result.price).toBeUndefined();
    expect(result.sku).toBeUndefined();
  });
});

// ---------------------------------------------------------------------------
// determineFlaggedFields
// ---------------------------------------------------------------------------

describe('determineFlaggedFields', () => {
  it('flags fields below the 0.70 threshold', () => {
    const confidence: OcrFieldConfidence = {
      title: 0.65,
      price: 0.55,
      sku: 0.80,
    };

    const flagged = determineFlaggedFields(confidence);

    expect(flagged).toContain('title');
    expect(flagged).toContain('price');
    expect(flagged).not.toContain('sku');
  });

  it('does not flag fields at exactly 0.70', () => {
    const confidence: OcrFieldConfidence = {
      title: 0.70,
      price: 0.70,
      sku: 0.70,
    };

    const flagged = determineFlaggedFields(confidence);

    expect(flagged).toHaveLength(0);
  });

  it('does not flag fields above the threshold', () => {
    const confidence: OcrFieldConfidence = {
      title: 0.95,
      price: 0.88,
      sku: 0.91,
    };

    const flagged = determineFlaggedFields(confidence);

    expect(flagged).toHaveLength(0);
  });

  it('does not flag undefined confidence scores', () => {
    const confidence: OcrFieldConfidence = {
      title: 0.50,
      // price and sku are undefined (not extracted)
    };

    const flagged = determineFlaggedFields(confidence);

    expect(flagged).toEqual(['title']);
  });

  it('returns empty array when all confidence scores are undefined', () => {
    const confidence: OcrFieldConfidence = {};

    const flagged = determineFlaggedFields(confidence);

    expect(flagged).toHaveLength(0);
  });

  it('flags field at 0.69 (just below threshold)', () => {
    const confidence: OcrFieldConfidence = {
      title: 0.69,
    };

    const flagged = determineFlaggedFields(confidence);

    expect(flagged).toContain('title');
  });

  it('exports the correct threshold constant', () => {
    expect(OCR_CONFIDENCE_THRESHOLD).toBe(0.70);
  });
});

// ---------------------------------------------------------------------------
// processImages (integration with mocked AWS services)
// ---------------------------------------------------------------------------

describe('processImages', () => {
  const baseInput: ImageProcessorInput = {
    images: [
      {
        s3Key: 'suppliers/tenant-1/sup-1/product-image.jpg',
        bucket: 'raw-uploads',
        fileName: 'product-image.jpg',
        contentType: 'image/jpeg',
      },
    ],
    tenantId: 'tenant-1',
    supplierId: 'sup-1',
    importJobId: 'import-123',
    assetsBucket: 'assets-bucket',
  };

  it('processes a single image successfully', async () => {
    textractMock.on(DetectDocumentTextCommand).resolves({
      Blocks: [
        { BlockType: 'LINE', Text: 'Organic Green Tea', Confidence: 92 },
        { BlockType: 'LINE', Text: '$15.99', Confidence: 88 },
        { BlockType: 'LINE', Text: 'SKU: OGT-001', Confidence: 95 },
      ],
    });
    s3Mock.on(CopyObjectCommand).resolves({});

    const result = await processImages(baseInput);

    expect(result.processedCount).toBe(1);
    expect(result.failedCount).toBe(0);
    expect(result.records).toHaveLength(1);

    const record = result.records[0]!;
    expect(record.title).toBe('Organic Green Tea');
    expect(record.price).toBe('$15.99');
    expect(record.sku).toBe('OGT-001');
    expect(record.flaggedForReview).toBe(false);
    expect(record.flaggedFields).toHaveLength(0);
    expect(record.heroImageKey).toBe('assets/tenant-1/sup-1/import-123/product-image.jpg');
    expect(record.images).toContain(record.heroImageKey);
  });

  it('flags fields with low confidence for review', async () => {
    textractMock.on(DetectDocumentTextCommand).resolves({
      Blocks: [
        { BlockType: 'LINE', Text: 'Blurry Product Name', Confidence: 55 },
        { BlockType: 'LINE', Text: '$9.99', Confidence: 60 },
        { BlockType: 'LINE', Text: 'SKU: BPN-X', Confidence: 85 },
      ],
    });
    s3Mock.on(CopyObjectCommand).resolves({});

    const result = await processImages(baseInput);

    expect(result.flaggedForReviewCount).toBe(1);

    const record = result.records[0]!;
    expect(record.flaggedForReview).toBe(true);
    expect(record.flaggedFields).toContain('title');
    expect(record.flaggedFields).toContain('price');
    expect(record.flaggedFields).not.toContain('sku');
    expect(record.ocrConfidence.title).toBe(0.55);
    expect(record.ocrConfidence.price).toBe(0.60);
    expect(record.ocrConfidence.sku).toBe(0.85);
  });

  it('handles multiple images with mixed results', async () => {
    const multiInput: ImageProcessorInput = {
      ...baseInput,
      images: [
        { s3Key: 'img1.jpg', bucket: 'raw-uploads', fileName: 'img1.jpg', contentType: 'image/jpeg' },
        { s3Key: 'img2.jpg', bucket: 'raw-uploads', fileName: 'img2.jpg', contentType: 'image/jpeg' },
        { s3Key: 'img3.jpg', bucket: 'raw-uploads', fileName: 'img3.jpg', contentType: 'image/jpeg' },
      ],
    };

    // First image succeeds with high confidence
    textractMock.on(DetectDocumentTextCommand)
      .resolvesOnce({
        Blocks: [
          { BlockType: 'LINE', Text: 'Product One', Confidence: 95 },
          { BlockType: 'LINE', Text: '$20.00', Confidence: 90 },
        ],
      })
      // Second image fails (Textract error)
      .rejectsOnce(new Error('Textract service error'))
      // Third image succeeds with low confidence
      .resolvesOnce({
        Blocks: [
          { BlockType: 'LINE', Text: 'Product Three', Confidence: 50 },
          { BlockType: 'LINE', Text: '$5.00', Confidence: 45 },
        ],
      });

    s3Mock.on(CopyObjectCommand).resolves({});

    const result = await processImages(multiInput);

    expect(result.processedCount).toBe(2);
    expect(result.failedCount).toBe(1);
    expect(result.flaggedForReviewCount).toBe(1);
    expect(result.records).toHaveLength(2);
  });

  it('handles Textract returning no text blocks', async () => {
    textractMock.on(DetectDocumentTextCommand).resolves({
      Blocks: [
        { BlockType: 'PAGE', Confidence: 99 },
      ],
    });
    s3Mock.on(CopyObjectCommand).resolves({});

    const result = await processImages(baseInput);

    expect(result.processedCount).toBe(1);
    expect(result.records).toHaveLength(1);

    const record = result.records[0]!;
    expect(record.title).toBeUndefined();
    expect(record.price).toBeUndefined();
    expect(record.sku).toBeUndefined();
    expect(record.flaggedForReview).toBe(false);
  });

  it('copies image to the correct assets bucket path', async () => {
    textractMock.on(DetectDocumentTextCommand).resolves({
      Blocks: [
        { BlockType: 'LINE', Text: 'Test Product', Confidence: 90 },
      ],
    });
    s3Mock.on(CopyObjectCommand).resolves({});

    await processImages(baseInput);

    const copyCall = s3Mock.commandCalls(CopyObjectCommand)[0];
    expect(copyCall).toBeDefined();
    expect(copyCall!.args[0].input).toEqual({
      CopySource: 'raw-uploads/suppliers/tenant-1/sup-1/product-image.jpg',
      Bucket: 'assets-bucket',
      Key: 'assets/tenant-1/sup-1/import-123/product-image.jpg',
    });
  });
});
