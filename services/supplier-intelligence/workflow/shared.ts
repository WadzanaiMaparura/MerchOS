/**
 * Shared plumbing for the import Step Functions task handlers (workflow/*.ts).
 *
 * WHY this layer exists: the processors (processors/*.ts) are pure library
 * functions. The state machine needs Lambda entry points that read the job's
 * input, call those functions, move the ImportJob through its statuses and hand
 * a small result to the next state.
 *
 * Records are NOT passed through the state machine: an Express execution's
 * payload is capped at 256 KB, which a real supplier catalogue exceeds. Each step
 * writes its output to the raw-uploads bucket under the job's work prefix and
 * passes only the S3 key on.
 */
import { DeleteObjectsCommand, GetObjectCommand, ListObjectsV2Command, PutObjectCommand, S3Client } from '@aws-sdk/client-s3';
import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { DynamoDBDocumentClient, GetCommand, UpdateCommand } from '@aws-sdk/lib-dynamodb';

import { updateImportJobStatus } from '../utils/import-job-status';
import type { ImportJob, ImportJobStatus, SourceType } from '../types';

// ---------------------------------------------------------------------------
// State machine input (built by handlers/import-queue-consumer.ts)
// ---------------------------------------------------------------------------

export interface WorkflowImage {
  s3Key: string;
  fileName: string;
  contentType: string;
}

export interface WorkflowInput {
  importJobId: string;
  tenantId: string;
  supplierId: string;
  sourceType: SourceType;
  /** S3 key (files), S3 prefix (images) or URL (crawls). */
  sourceReference: string;
  fileName?: string;
  contentType?: string;
  fileSizeBytes?: number;
  url?: string;
  crawlDepth?: number;
  images?: WorkflowImage[];
  /** Added by each LambdaInvoke via resultSelector { result: $.Payload }. */
  parseResult?: { result: StepOutput };
  validationResult?: { result: StepOutput };
  deduplicationResult?: { result: StepOutput };
}

/** What every step returns: a pointer to its S3 work file plus counts for the logs. */
export interface StepOutput {
  key: string;
  count: number;
}

// ---------------------------------------------------------------------------
// Clients (lazy singletons; overridable in tests)
// ---------------------------------------------------------------------------

let s3: S3Client | undefined;
let ddb: DynamoDBDocumentClient | undefined;

export function getS3(): S3Client {
  return (s3 ??= new S3Client({}));
}
export function getDdb(): DynamoDBDocumentClient {
  return (ddb ??= DynamoDBDocumentClient.from(new DynamoDBClient({}), {
    marshallOptions: { removeUndefinedValues: true },
  }));
}
export function setWorkflowClients(c: { s3?: S3Client; ddb?: DynamoDBDocumentClient }): void {
  if (c.s3) s3 = c.s3;
  if (c.ddb) ddb = c.ddb;
}

export function env(name: string): string {
  const v = process.env[name];
  if (!v) throw new Error(`${name} environment variable is not set`);
  return v;
}

// ---------------------------------------------------------------------------
// S3 work files
// ---------------------------------------------------------------------------

export function workPrefix(i: Pick<WorkflowInput, 'tenantId' | 'supplierId' | 'importJobId'>): string {
  return `suppliers/${i.tenantId}/${i.supplierId}/work/${i.importJobId}/`;
}

export async function readObjectBytes(key: string, bucket = env('RAW_UPLOADS_BUCKET')): Promise<Buffer> {
  const res = await getS3().send(new GetObjectCommand({ Bucket: bucket, Key: key }));
  if (!res.Body) throw new Error(`S3 object ${key} has no body`);
  return Buffer.from(await res.Body.transformToByteArray());
}

export async function writeWork(input: WorkflowInput, name: string, data: unknown): Promise<string> {
  const key = `${workPrefix(input)}${name}.json`;
  await getS3().send(new PutObjectCommand({
    Bucket: env('RAW_UPLOADS_BUCKET'),
    Key: key,
    Body: JSON.stringify(data),
    ContentType: 'application/json',
  }));
  return key;
}

export async function readWork<T>(key: string): Promise<T> {
  return JSON.parse((await readObjectBytes(key)).toString('utf8')) as T;
}

/** Best-effort removal of the job's intermediate files (they hold catalogue data). */
export async function deleteWork(input: Pick<WorkflowInput, 'tenantId' | 'supplierId' | 'importJobId'>): Promise<void> {
  const bucket = env('RAW_UPLOADS_BUCKET');
  const listed = await getS3().send(new ListObjectsV2Command({ Bucket: bucket, Prefix: workPrefix(input) }));
  const objects = (listed.Contents ?? []).flatMap((o) => (o.Key ? [{ Key: o.Key }] : []));
  if (objects.length) {
    await getS3().send(new DeleteObjectsCommand({ Bucket: bucket, Delete: { Objects: objects, Quiet: true } }));
  }
}

/** Throws unless the step received the previous step's output. */
export function requireResult(r: { result: StepOutput } | undefined, step: string): StepOutput {
  if (!r?.result?.key) throw new Error(`Missing ${step} output in workflow state`);
  return r.result;
}

// ---------------------------------------------------------------------------
// Import job helpers
// ---------------------------------------------------------------------------

export async function getJob(tenantId: string, importJobId: string): Promise<ImportJob | undefined> {
  const res = await getDdb().send(new GetCommand({
    TableName: env('IMPORT_JOBS_TABLE'),
    Key: { PK: `TENANT#${tenantId}`, SK: `IMPORT#${importJobId}` },
    ConsistentRead: true,
  }));
  return res.Item as ImportJob | undefined;
}

/**
 * Moves the job from `from` to `to`, tolerating a Step Functions retry of a
 * step that already made the transition (the job is then already at `to`).
 */
export async function transition(
  input: WorkflowInput,
  from: ImportJobStatus,
  to: ImportJobStatus,
  progress: { percentage: number; currentStep: string },
): Promise<void> {
  try {
    await updateImportJobStatus({
      tenantId: input.tenantId,
      importJobId: input.importJobId,
      currentStatus: from,
      newStatus: to,
      progress,
    });
  } catch (error) {
    if ((error as { name?: string }).name === 'ConditionalCheckFailedException') {
      const job = await getJob(input.tenantId, input.importJobId);
      if (job?.status === to) return;
      throw new Error(`Import job ${input.importJobId} is ${job?.status ?? 'missing'}, expected ${from}`);
    }
    throw error;
  }
}

/** Sets arbitrary non-status fields on the job (results, summaries, errors). */
export async function setJobFields(input: Pick<WorkflowInput, 'tenantId' | 'importJobId'>, fields: Record<string, unknown>): Promise<void> {
  const entries = Object.entries(fields).filter(([, v]) => v !== undefined);
  if (!entries.length) return;
  const names: Record<string, string> = {};
  const values: Record<string, unknown> = {};
  const sets = entries.map(([k, v], i) => {
    names[`#f${i}`] = k;
    values[`:v${i}`] = v;
    return `#f${i} = :v${i}`;
  });
  await getDdb().send(new UpdateCommand({
    TableName: env('IMPORT_JOBS_TABLE'),
    Key: { PK: `TENANT#${input.tenantId}`, SK: `IMPORT#${input.importJobId}` },
    UpdateExpression: `SET ${sets.join(', ')}`,
    ConditionExpression: 'attribute_exists(PK)',
    ExpressionAttributeNames: names,
    ExpressionAttributeValues: values,
  }));
}
