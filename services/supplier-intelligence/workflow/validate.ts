/**
 * Step Functions task: ValidateRecords. Moves the job PROCESSING -> VALIDATING,
 * validates/normalises every parsed record and records a validation summary and
 * per-row errors on the job so the seller can see what to fix.
 */
import { validateRecords } from '../processors/validation-engine';
import type { ValidatedRecord } from '../types/validation.types';
import type { ImportJobError } from '../types';
import { ImportInputError, type ParsedWork, type RecordMeta } from './parse-common';
import { readWork, requireResult, setJobFields, transition, writeWork, type StepOutput, type WorkflowInput } from './shared';

/** Bounds the item size of the job record (DynamoDB items max out at 400 KB). */
export const MAX_RECORDED_ERRORS = 100;

export interface ValidatedWork {
  /** Parsed-record count (what was extracted from the source). */
  totalExtracted: number;
  records: Array<ValidatedRecord & { meta?: RecordMeta }>;
}

export async function handler(input: WorkflowInput): Promise<StepOutput> {
  const parsedRef = requireResult(input.parseResult, 'parse');
  await transition(input, 'PROCESSING', 'VALIDATING', { percentage: 40, currentStep: 'Validating records' });

  const parsed = await readWork<ParsedWork>(parsedRef.key);
  const result = validateRecords(parsed.records);

  // validateRecords keeps input order, so index i is parsed.records[i].
  const errors: ImportJobError[] = [];
  result.records.forEach((r, i) => {
    if (r.status !== 'VALIDATION_FAILED') return;
    const row = parsed.records[i]?.sourceRowIndex ?? i + 1;
    for (const e of r.errors) {
      if (errors.length >= MAX_RECORDED_ERRORS) return;
      errors.push({ code: e.code, message: `Row ${row}: ${e.message}`, field: e.field, recordIndex: row });
    }
  });

  await setJobFields(input, {
    validationSummary: {
      totalRecords: result.totalRecords,
      passed: result.passed,
      failed: result.failed,
      fieldErrorCounts: result.fieldErrorCounts,
    },
    errors,
    progress: { percentage: 55, currentStep: `${result.passed} of ${result.totalRecords} record(s) valid` },
  });

  if (result.passed === 0) {
    const top = Object.entries(result.fieldErrorCounts)
      .sort((a, b) => b[1] - a[1])
      .slice(0, 3)
      .map(([field, n]) => `${field} (${n})`)
      .join(', ');
    throw new ImportInputError(
      'ALL_RECORDS_INVALID',
      `None of the ${result.totalRecords} record(s) passed validation${top ? `. Most common problems: ${top}` : ''}.`,
    );
  }

  const work: ValidatedWork = {
    totalExtracted: parsed.records.length,
    records: result.records.map((r, i) => {
      const meta = parsed.meta?.[i];
      return meta ? { ...r, meta } : r;
    }),
  };
  const key = await writeWork(input, 'validated', work);
  return { key, count: result.passed };
}
