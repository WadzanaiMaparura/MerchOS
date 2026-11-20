/**
 * Step Functions task: ProcessImages, OCRs each uploaded product photo with
 * Textract and copies it to the assets bucket. OCR confidence travels with each
 * record so low-confidence products are flagged for review when persisted.
 */
import { processImages } from '../processors/image-processor';
import { finishParse, ImportInputError, markParsing } from './parse-common';
import { env, type StepOutput, type WorkflowInput } from './shared';

export async function handler(input: WorkflowInput): Promise<StepOutput> {
  await markParsing(input);
  const images = input.images ?? [];
  if (images.length === 0) {
    throw new ImportInputError('NO_IMAGES', 'The image import has no uploaded images.');
  }

  const bucket = env('RAW_UPLOADS_BUCKET');
  const result = await processImages({
    images: images.map((i) => ({ s3Key: i.s3Key, bucket, fileName: i.fileName, contentType: i.contentType })),
    tenantId: input.tenantId,
    supplierId: input.supplierId,
    importJobId: input.importJobId,
    assetsBucket: env('ASSETS_BUCKET'),
  });

  return finishParse(input, {
    records: result.records,
    meta: result.records.map((r) => {
      const scores = Object.values(r.ocrConfidence).filter((v): v is number => typeof v === 'number');
      return {
        ...(scores.length ? { ocrConfidence: Math.min(...scores) } : {}),
        flaggedForReview: r.flaggedForReview,
      };
    }),
  });
}
