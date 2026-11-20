/**
 * Shared output handling for the parse steps (file, PDF, ZIP, image, URL).
 */
import type { ParsedRecord } from '../processors/file-parser';
import { setJobFields, writeWork, type StepOutput, type WorkflowInput } from './shared';

/** Fails the import without Step Functions retrying it (the input will not change). */
export class ImportInputError extends Error {
  constructor(public readonly code: string, message: string) {
    // Lambda only serialises errorType + errorMessage, so the code rides in the message.
    super(`[${code}] ${message}`);
    // Step Functions reports this as the error type; the stack marks it non-retryable.
    this.name = 'ImportInputError';
  }
}

/** Extra per-record provenance carried alongside the parsed record (by index). */
export interface RecordMeta {
  ocrConfidence?: number;
  flaggedForReview?: boolean;
}

export interface ParsedWork {
  records: ParsedRecord[];
  /** Same length as records when present. */
  meta?: RecordMeta[];
}

/** Writes the parsed records for the next step and reports progress on the job. */
export async function finishParse(
  input: WorkflowInput,
  work: ParsedWork,
  extraJobFields: Record<string, unknown> = {},
): Promise<StepOutput> {
  if (work.records.length === 0) {
    throw new ImportInputError(
      'NO_PRODUCTS_FOUND',
      'No products were found in the uploaded source. Check that the file has a header row with columns such as title, sku and price.',
    );
  }
  const key = await writeWork(input, 'parsed', work);
  await setJobFields(input, {
    progress: { percentage: 30, currentStep: `Extracted ${work.records.length} record(s)` },
    ...extraJobFields,
  });
  return { key, count: work.records.length };
}

/** The job is PROCESSING when the workflow starts (set by the queue consumer). */
export async function markParsing(input: WorkflowInput): Promise<void> {
  // No status change here (PROCESSING covers parsing); only a progress hint.
  await setJobFields(input, { progress: { percentage: 10, currentStep: 'Reading source' } });
}
