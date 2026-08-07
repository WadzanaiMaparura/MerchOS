/**
 * Import Queue Consumer — SQS Lambda handler.
 *
 * Triggered by the SQS FIFO queue. For each message:
 * 1. Parse the SQS message body (JSON with import job parameters)
 * 2. Update import job status from QUEUED → PROCESSING
 * 3. Start a Step Functions execution with the import job parameters
 * 4. On failure, throw to allow SQS retry (eventually routes to DLQ after maxReceiveCount)
 *
 * Requirements: 5.2, 14.4
 */

import type { SQSEvent, SQSBatchResponse, SQSBatchItemFailure } from 'aws-lambda';
import { SFNClient, StartExecutionCommand } from '@aws-sdk/client-sfn';

import { updateImportJobStatus } from '../utils/import-job-status';
import { recordImportInitiated } from '../utils/metrics';
import type { SourceType } from '../types';
import { logger } from '../../shared/middleware/powertools';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/**
 * Shape of the SQS message body sent by import trigger handlers.
 */
interface ImportQueueMessage {
  importJobId: string;
  tenantId: string;
  supplierId: string;
  sourceType: SourceType;
  sourceReference: string;
  fileName?: string;
  contentType?: string;
  fileSizeBytes?: number;
  url?: string;
  crawlDepth?: number;
}

// ---------------------------------------------------------------------------
// AWS SDK Clients (singleton for connection reuse across invocations)
// ---------------------------------------------------------------------------

const region = process.env['AWS_REGION'] ?? 'af-south-1';

let sfnClient: SFNClient | null = null;
function getSfnClient(): SFNClient {
  if (!sfnClient) {
    sfnClient = new SFNClient({ region });
  }
  return sfnClient;
}

// ---------------------------------------------------------------------------
// Handler
// ---------------------------------------------------------------------------

/**
 * SQS batch handler implementing partial batch failure reporting.
 *
 * Returns `batchItemFailures` array so that only failed messages are retried,
 * rather than the entire batch. Messages that exceed maxReceiveCount are
 * automatically routed to the DLQ by SQS.
 */
export async function handler(event: SQSEvent): Promise<SQSBatchResponse> {
  const stateMachineArn = process.env['IMPORT_STATE_MACHINE_ARN'];

  if (!stateMachineArn) {
    logger.error('Missing IMPORT_STATE_MACHINE_ARN environment variable');
    // Fail the entire batch — configuration error should not silently discard messages
    return {
      batchItemFailures: event.Records.map((record) => ({
        itemIdentifier: record.messageId,
      })),
    };
  }

  const batchItemFailures: SQSBatchItemFailure[] = [];

  for (const record of event.Records) {
    try {
      await processRecord(record.body, stateMachineArn);
    } catch (error) {
      logger.error('Failed to process SQS message', {
        messageId: record.messageId,
        error: error instanceof Error ? error.message : String(error),
      });

      // Report this item as failed so SQS retries it (and eventually routes to DLQ)
      batchItemFailures.push({ itemIdentifier: record.messageId });
    }
  }

  return { batchItemFailures };
}

// ---------------------------------------------------------------------------
// Record Processing
// ---------------------------------------------------------------------------

/**
 * Process a single SQS record:
 * 1. Parse the message body
 * 2. Transition the import job status QUEUED → PROCESSING
 * 3. Start a Step Functions execution with the import job payload
 */
async function processRecord(messageBody: string, stateMachineArn: string): Promise<void> {
  // Step 1: Parse message body
  const message = parseMessageBody(messageBody);

  // Append correlation IDs to structured logger for all subsequent log entries
  logger.appendKeys({
    tenantId: message.tenantId,
    importJobId: message.importJobId,
    supplierId: message.supplierId,
  });

  logger.info('Processing import queue message', {
    sourceType: message.sourceType,
  });

  // Step 2: Transition QUEUED → PROCESSING
  await updateImportJobStatus({
    tenantId: message.tenantId,
    importJobId: message.importJobId,
    currentStatus: 'QUEUED',
    newStatus: 'PROCESSING',
    progress: {
      percentage: 0,
      currentStep: 'Starting import workflow',
    },
  });

  logger.info('Import job status updated to PROCESSING', {
    importJobId: message.importJobId,
  });

  // Emit ImportsInitiated metric
  recordImportInitiated({
    tenantId: message.tenantId,
    sourceType: message.sourceType,
  });

  // Step 3: Start Step Functions execution
  const executionName = `import-${message.importJobId}-${Date.now()}`;

  const startExecutionResponse = await getSfnClient().send(
    new StartExecutionCommand({
      stateMachineArn,
      name: executionName,
      input: JSON.stringify({
        importJobId: message.importJobId,
        tenantId: message.tenantId,
        supplierId: message.supplierId,
        sourceType: message.sourceType,
        sourceReference: message.sourceReference,
        fileName: message.fileName,
        contentType: message.contentType,
        fileSizeBytes: message.fileSizeBytes,
        url: message.url,
        crawlDepth: message.crawlDepth,
      }),
    }),
  );

  logger.info('Step Functions execution started', {
    importJobId: message.importJobId,
    executionArn: startExecutionResponse.executionArn,
    executionName,
  });
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Parses and validates the SQS message body. Throws if the message is
 * malformed or missing required fields.
 */
function parseMessageBody(body: string): ImportQueueMessage {
  let parsed: unknown;

  try {
    parsed = JSON.parse(body);
  } catch {
    throw new Error(`Failed to parse SQS message body as JSON: ${body.slice(0, 200)}`);
  }

  if (typeof parsed !== 'object' || parsed === null) {
    throw new Error('SQS message body is not a valid JSON object');
  }

  const msg = parsed as Record<string, unknown>;

  // Validate required fields
  const requiredFields = ['importJobId', 'tenantId', 'supplierId', 'sourceType', 'sourceReference'];
  const missingFields = requiredFields.filter(
    (field) => typeof msg[field] !== 'string' || (msg[field] as string).trim() === '',
  );

  if (missingFields.length > 0) {
    throw new Error(`SQS message missing required fields: ${missingFields.join(', ')}`);
  }

  return {
    importJobId: msg['importJobId'] as string,
    tenantId: msg['tenantId'] as string,
    supplierId: msg['supplierId'] as string,
    sourceType: msg['sourceType'] as SourceType,
    sourceReference: msg['sourceReference'] as string,
    fileName: typeof msg['fileName'] === 'string' ? msg['fileName'] : undefined,
    contentType: typeof msg['contentType'] === 'string' ? msg['contentType'] : undefined,
    fileSizeBytes: typeof msg['fileSizeBytes'] === 'number' ? msg['fileSizeBytes'] : undefined,
    url: typeof msg['url'] === 'string' ? msg['url'] : undefined,
    crawlDepth: typeof msg['crawlDepth'] === 'number' ? msg['crawlDepth'] : undefined,
  };
}
