/**
 * Step Functions task for both PersistProducts and HandleFailure.
 *
 * PersistProducts: VALIDATING -> PERSISTING, applies MERGE updates to existing
 * products, writes the new DRAFT products (persistProducts moves the job to
 * COMPLETED and emits ImportJobCompleted), then records the final results.
 *
 * HandleFailure ({ action: 'RECORD_FAILURE' }): marks the job FAILED with a
 * message the seller can act on and emits ImportJobFailed.
 *
 * Both are safe to retry: product IDs were fixed by the dedupe step, and a job
 * that already reached a terminal status is left as it is.
 */
import { UpdateCommand } from '@aws-sdk/lib-dynamodb';

import { persistProducts } from '../processors/product-persister';
import { emitImportJobFailed } from '../utils/event-emitter';
import { updateImportJobStatus } from '../utils/import-job-status';
import { recordImportCompleted, recordImportFailed } from '../utils/metrics';
import { logger } from '../../shared/middleware/powertools';
import type { ImportJobError, ImportJobResults } from '../types';
import type { DedupedWork, MergeUpdate } from './detect-duplicates';
import {
  deleteWork, env, getDdb, getJob, readWork, requireResult, setJobFields, transition,
  type WorkflowInput,
} from './shared';

export interface RecordFailureEvent {
  action: 'RECORD_FAILURE';
  jobId: string;
  tenantId: string;
  /** Step Functions Catch output. */
  error?: { Error?: string; Cause?: string };
}

type Event = WorkflowInput | RecordFailureEvent;

function isFailure(e: Event): e is RecordFailureEvent {
  return (e as RecordFailureEvent).action === 'RECORD_FAILURE';
}

export async function handler(event: Event): Promise<unknown> {
  return isFailure(event) ? recordFailure(event) : persist(event);
}

// ---------------------------------------------------------------------------
// Persist
// ---------------------------------------------------------------------------

/** Updates only the fields the supplier sent; seller edits to other fields survive. */
async function applyMerge(tenantId: string, m: MergeUpdate): Promise<boolean> {
  const r = m.record as Record<string, unknown>;
  const names: Record<string, string> = { '#u': 'updatedAt' };
  const values: Record<string, unknown> = { ':u': new Date().toISOString() };
  const sets = ['#u = :u'];
  const add = (path: string[], value: unknown, tag: string) => {
    if (value === undefined || value === null || value === '') return;
    const p = path.map((seg) => { names[`#${seg}`] = seg; return `#${seg}`; }).join('.');
    values[`:${tag}`] = value;
    sets.push(`${p} = :${tag}`);
  };
  add(['content', 'title'], r['title'], 'title');
  add(['content', 'longDescription'], r['description'], 'desc');
  add(['content', 'brand'], r['brand'], 'brand');
  if (typeof r['price'] === 'number') add(['commercial', 'sellingPrice'], r['price'], 'price');

  try {
    await getDdb().send(new UpdateCommand({
      TableName: env('PRODUCTS_TABLE_NAME'),
      Key: { PK: `TENANT#${tenantId}`, SK: `PRODUCT#${m.existingProductId}` },
      UpdateExpression: `SET ${sets.join(', ')}`,
      ConditionExpression: 'attribute_exists(PK)',
      ExpressionAttributeNames: names,
      ExpressionAttributeValues: values,
    }));
    return true;
  } catch (error) {
    // Deleted between dedupe and persist: nothing to merge into.
    if ((error as { name?: string }).name === 'ConditionalCheckFailedException') return false;
    throw error;
  }
}

async function persist(input: WorkflowInput) {
  const dedupedRef = requireResult(input.deduplicationResult, 'deduplication');
  const job = await getJob(input.tenantId, input.importJobId);
  if (!job) throw new Error(`Import job ${input.importJobId} not found`);
  if (job.status === 'COMPLETED') return { results: job.results ?? null, alreadyCompleted: true };

  await transition(input, 'VALIDATING', 'PERSISTING', { percentage: 80, currentStep: 'Saving products' });
  const work = await readWork<DedupedWork>(dedupedRef.key);

  let updated = 0;
  for (const m of work.merge) {
    if (await applyMerge(input.tenantId, m)) updated++;
  }

  const counts: Omit<ImportJobResults, 'created'> = {
    totalExtracted: work.totalExtracted,
    updated,
    duplicates: work.duplicates,
    validationFailed: work.validationFailed,
  };
  // Written before the COMPLETED transition so a poller never sees COMPLETED without results.
  await setJobFields(input, { results: { ...counts, created: work.create.length } });

  const outcome = await persistProducts({
    tenantId: input.tenantId,
    importJobId: input.importJobId,
    supplierId: input.supplierId,
    sourceType: input.sourceType,
    products: work.create,
    resultCounts: counts,
    ...(job.startedAt ? { jobStartedAt: job.startedAt } : {}),
  });

  const fields: Record<string, unknown> = { results: outcome.jobResults };
  const errors: ImportJobError[] = [...(job.errors ?? [])];
  if (outcome.failureError) {
    errors.push({
      code: 'PARTIAL_WRITE',
      message: `${outcome.failed} product(s) could not be saved. Re-run the import to retry them.`,
    });
    logger.error('Partial product write', { importJobId: input.importJobId, error: outcome.failureError });
  }
  const blocked = outcome.jobResults.blockedByTrial ?? 0;
  if (blocked > 0) {
    // Not a failure: the import created what the seller's trial or plan allows.
    const reason = outcome.jobResults.blockedReason ?? 'TRIAL_LIMIT_REACHED';
    errors.push({
      code: reason,
      message:
        reason === 'PLAN_PAUSED'
          ? `${blocked} product(s) were not imported because your plan is paused. Pay on the Billing page, then import the rest.`
          : reason === 'PLAN_LIMIT_REACHED'
            ? `${blocked} product(s) were not imported because this month's plan allowance is used up. Upgrade your plan, or import the rest next month.`
            : `${blocked} product(s) were not imported because your free trial limit was reached. Subscribe to import the rest.`,
    });
  }
  if (errors.length > (job.errors?.length ?? 0)) fields['errors'] = errors;
  await setJobFields(input, fields);
  recordImportCompleted({ tenantId: input.tenantId, sourceType: input.sourceType });

  await deleteWork(input).catch((e: unknown) => logger.warn('Could not delete import work files', { error: String(e) }));
  return { results: outcome.jobResults };
}

// ---------------------------------------------------------------------------
// Failure
// ---------------------------------------------------------------------------

/** Turns the Step Functions Catch output into a message safe to show the seller. */
export function describeFailure(err: RecordFailureEvent['error']): { code: string; message: string } {
  let type = err?.Error ?? 'UNKNOWN';
  let message = '';
  try {
    const cause = JSON.parse(err?.Cause ?? '{}') as { errorType?: string; errorMessage?: string };
    type = cause.errorType ?? type;
    message = cause.errorMessage ?? '';
  } catch {
    message = err?.Cause ?? '';
  }

  if (type === 'ImportInputError') {
    // ImportInputError messages are written for the seller: "[CODE] text".
    const m = /^\[([A-Z_]+)\]\s*(.*)$/s.exec(message);
    return m ? { code: m[1]!, message: m[2]! } : { code: 'INVALID_IMPORT', message };
  }
  if (type === 'UNSUPPORTED_SOURCE_TYPE') return { code: type, message: 'This import type is not supported.' };
  if (type === 'States.Timeout') {
    return { code: 'TIMEOUT', message: 'The import took too long to process. Try splitting it into smaller files.' };
  }
  return { code: 'PROCESSING_ERROR', message: 'The import failed unexpectedly. Please try again, or contact support if it keeps failing.' };
}

async function recordFailure(event: RecordFailureEvent) {
  const job = await getJob(event.tenantId, event.jobId);
  if (!job) {
    logger.error('RECORD_FAILURE for a missing job', { importJobId: event.jobId });
    return { recorded: false };
  }
  logger.error('Import workflow failed', { importJobId: event.jobId, error: event.error });
  if (job.status === 'COMPLETED' || job.status === 'FAILED') return { recorded: false, status: job.status };

  const failure = describeFailure(event.error);
  const ids = { tenantId: event.tenantId, supplierId: job.supplierId, importJobId: event.jobId };

  try {
    await updateImportJobStatus({
      tenantId: event.tenantId,
      importJobId: event.jobId,
      currentStatus: job.status,
      newStatus: 'FAILED',
      progress: { percentage: job.progress?.percentage ?? 0, currentStep: 'Failed' },
    });
  } catch (error) {
    // A concurrent retry already recorded it.
    if ((error as { name?: string }).name !== 'ConditionalCheckFailedException') throw error;
    return { recorded: false };
  }
  await setJobFields(ids, { errors: [...(job.errors ?? []), failure] });
  recordImportFailed({ tenantId: event.tenantId, sourceType: job.sourceType });

  await emitImportJobFailed({ ...ids, error: failure })
    .catch((e: unknown) => logger.warn('Could not emit ImportJobFailed', { error: String(e) }));
  await deleteWork(ids).catch((e: unknown) => logger.warn('Could not delete import work files', { error: String(e) }));
  return { recorded: true, ...failure };
}
