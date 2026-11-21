/**
 * Scheduled sweeper (EventBridge, every 10 minutes): fails import jobs that will
 * never finish on their own.
 *
 * WHY: the import workflow is a Step Functions EXPRESS execution, hard-capped at
 * 5 minutes, and Express workflows emit no status-change events. If one times
 * out (or the Lambda/SFN start fails after the job left QUEUED), no Catch runs
 * and the job sat in PROCESSING forever, with the seller watching a spinner.
 *
 * A job is abandoned when it has not changed for longer than its status can
 * legitimately take:
 *   PROCESSING / VALIDATING / PERSISTING  15 min   (workflow max is 5)
 *   QUEUED                                60 min   (SQS retries: 3 x 5 min visibility)
 *   AWAITING_UPLOAD                       24 h     (upload links expire after 15 min)
 *
 * Each is moved to FAILED with a conditional write (a job that just progressed is
 * left alone), gets a seller-readable error, emits ImportJobFailed and has its
 * intermediate work files removed.
 *
 * Scans the import-jobs table: fine at current volume (small table, cheap
 * filtered scan). If it grows large, add a status GSI that spans tenants.
 */
import { ScanCommand, type ScanCommandOutput } from '@aws-sdk/lib-dynamodb';

import { updateImportJobStatus } from '../utils/import-job-status';
import { emitImportJobFailed } from '../utils/event-emitter';
import { recordImportFailed } from '../utils/metrics';
import { logger } from '../../shared/middleware/powertools';
import type { ImportJob, ImportJobError, ImportJobStatus } from '../types';
import { deleteWork, env, getDdb, setJobFields } from '../workflow/shared';

const MINUTE = 60_000;

export const STALE_AFTER_MS: Partial<Record<ImportJobStatus, number>> = {
  PROCESSING: 15 * MINUTE,
  VALIDATING: 15 * MINUTE,
  PERSISTING: 15 * MINUTE,
  QUEUED: 60 * MINUTE,
  AWAITING_UPLOAD: 24 * 60 * MINUTE,
};

const TIMED_OUT: ImportJobError = {
  code: 'TIMEOUT',
  message: 'The import took too long and was stopped. Split the file into smaller files and import again.',
};

export const STALE_ERRORS: Partial<Record<ImportJobStatus, ImportJobError>> = {
  PROCESSING: TIMED_OUT,
  VALIDATING: TIMED_OUT,
  PERSISTING: TIMED_OUT,
  QUEUED: { code: 'NOT_STARTED', message: 'The import did not start. Please start it again.' },
  AWAITING_UPLOAD: {
    code: 'UPLOAD_NOT_COMPLETED',
    message: 'The file upload was not completed. Upload the file again to import it.',
  },
};

/** Bounds one run; the next run (10 min later) continues. */
const MAX_PAGES = 50;

type JobRow = Pick<ImportJob, 'tenantId' | 'importJobId' | 'supplierId' | 'sourceType' | 'status' | 'createdAt'> & {
  updatedAt?: string;
  errors?: ImportJobError[];
};

/** Exported for tests. */
export function isStale(job: JobRow, now: number): boolean {
  const limit = STALE_AFTER_MS[job.status];
  if (limit === undefined) return false;
  const last = Date.parse(job.updatedAt ?? job.createdAt ?? '');
  return Number.isFinite(last) && now - last > limit;
}

async function failJob(job: JobRow): Promise<boolean> {
  const error = STALE_ERRORS[job.status]!;
  try {
    await updateImportJobStatus({
      tenantId: job.tenantId,
      importJobId: job.importJobId,
      currentStatus: job.status,
      newStatus: 'FAILED',
      progress: { percentage: 0, currentStep: 'Failed' },
    });
  } catch (e) {
    // It moved on since the scan (progressed or completed): leave it.
    if ((e as { name?: string }).name === 'ConditionalCheckFailedException') return false;
    throw e;
  }
  const ids = { tenantId: job.tenantId, supplierId: job.supplierId, importJobId: job.importJobId };
  await setJobFields(ids, { errors: [...(job.errors ?? []), error] });
  recordImportFailed({ tenantId: job.tenantId, sourceType: job.sourceType });
  await emitImportJobFailed({ ...ids, error })
    .catch((e: unknown) => logger.warn('Could not emit ImportJobFailed', { error: String(e) }));
  await deleteWork(ids)
    .catch((e: unknown) => logger.warn('Could not delete import work files', { error: String(e) }));
  return true;
}

export async function handler(): Promise<{ scanned: number; failed: number }> {
  const now = Date.now();
  const statuses = Object.keys(STALE_AFTER_MS);
  const values: Record<string, string> = {};
  statuses.forEach((s, i) => { values[`:s${i}`] = s; });

  let scanned = 0;
  let failed = 0;
  let startKey: Record<string, unknown> | undefined;
  for (let page = 0; page < MAX_PAGES; page++) {
    const res: ScanCommandOutput = await getDdb().send(new ScanCommand({
      TableName: env('IMPORT_JOBS_TABLE'),
      FilterExpression: `begins_with(SK, :import) AND #status IN (${statuses.map((_, i) => `:s${i}`).join(', ')})`,
      ExpressionAttributeNames: { '#status': 'status' },
      ExpressionAttributeValues: { ':import': 'IMPORT#', ...values },
      ProjectionExpression: 'tenantId, importJobId, supplierId, sourceType, #status, createdAt, updatedAt, errors',
      ...(startKey ? { ExclusiveStartKey: startKey } : {}),
    }));
    for (const item of (res.Items ?? []) as JobRow[]) {
      scanned++;
      if (!isStale(item, now)) continue;
      try {
        if (await failJob(item)) {
          failed++;
          logger.warn('Abandoned import marked FAILED', {
            tenantId: item.tenantId, importJobId: item.importJobId, status: item.status,
          });
        }
      } catch (e) {
        logger.error('Could not fail abandoned import', { importJobId: item.importJobId, error: String(e) });
      }
    }
    startKey = res.LastEvaluatedKey as Record<string, unknown> | undefined;
    if (!startKey) break;
  }
  logger.info('Stuck import sweep finished', { scanned, failed });
  return { scanned, failed };
}
