/**
 * Import Job Status Update Utility
 *
 * Enforces valid import job status transitions and updates DynamoDB records
 * with progress metadata.
 *
 * Valid transition paths:
 *   QUEUED → PROCESSING → VALIDATING → PERSISTING → COMPLETED
 *   Any active state (QUEUED | PROCESSING | VALIDATING | PERSISTING) → FAILED
 *
 * Terminal states: COMPLETED, FAILED — no transitions out of these.
 *
 * @see Requirements 5.5, 8.4
 */

import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { DynamoDBDocumentClient, UpdateCommand } from '@aws-sdk/lib-dynamodb';
import type { ImportJobStatus, ImportJobProgress } from '../types/supplier.types';

// ---------------------------------------------------------------------------
// Transition Map
// ---------------------------------------------------------------------------

/**
 * Exhaustive map of every status to the set of statuses it may legally
 * transition to. Export it so callers and tests can inspect it directly.
 */
export const VALID_TRANSITIONS: Readonly<Record<ImportJobStatus, ReadonlySet<ImportJobStatus>>> = {
  QUEUED: new Set<ImportJobStatus>(['PROCESSING', 'FAILED']),
  PROCESSING: new Set<ImportJobStatus>(['VALIDATING', 'FAILED']),
  VALIDATING: new Set<ImportJobStatus>(['PERSISTING', 'FAILED']),
  PERSISTING: new Set<ImportJobStatus>(['COMPLETED', 'FAILED']),
  COMPLETED: new Set<ImportJobStatus>([]),
  FAILED: new Set<ImportJobStatus>([]),
};

// ---------------------------------------------------------------------------
// isValidTransition
// ---------------------------------------------------------------------------

/**
 * Returns `true` when transitioning from `from` to `to` is permitted.
 *
 * @param from - Current status
 * @param to   - Desired target status
 */
export function isValidTransition(from: ImportJobStatus, to: ImportJobStatus): boolean {
  return VALID_TRANSITIONS[from].has(to);
}

// ---------------------------------------------------------------------------
// updateImportJobStatus params
// ---------------------------------------------------------------------------

export interface UpdateImportJobStatusParams {
  /** DynamoDB table name for Import Jobs (reads from IMPORT_JOBS_TABLE env var if omitted) */
  tableName?: string;
  /** Tenant identifier (used as the DynamoDB PK: `TENANT#{tenantId}`) */
  tenantId: string;
  /** Import job identifier (used as the DynamoDB SK: `IMPORT#{importJobId}`) */
  importJobId: string;
  /** The current/previous status — transition will be validated from this value */
  currentStatus: ImportJobStatus;
  /** The target status to transition to */
  newStatus: ImportJobStatus;
  /** Optional progress metadata to persist alongside the status update */
  progress?: ImportJobProgress;
  /**
   * Optional ISO 8601 timestamp to record on the job.
   * - Automatically set as `startedAt` when transitioning to PROCESSING.
   * - Automatically set as `completedAt` when transitioning to COMPLETED or FAILED.
   * If provided explicitly it overrides the automatic value.
   */
  timestamp?: string;
}

// ---------------------------------------------------------------------------
// DynamoDB Client Singleton
// ---------------------------------------------------------------------------

let ddbDocClient: DynamoDBDocumentClient | null = null;

function getDynamoDocClient(): DynamoDBDocumentClient {
  if (!ddbDocClient) {
    const client = new DynamoDBClient({
      region: process.env['AWS_REGION'] ?? 'af-south-1',
    });
    ddbDocClient = DynamoDBDocumentClient.from(client);
  }
  return ddbDocClient;
}

/**
 * Override the DynamoDB Document Client (used for testing).
 */
export function setDynamoDocClient(client: DynamoDBDocumentClient): void {
  ddbDocClient = client;
}

// ---------------------------------------------------------------------------
// updateImportJobStatus
// ---------------------------------------------------------------------------

/**
 * Validates the requested status transition and, if valid, updates the
 * ImportJob record in DynamoDB with the new status and optional progress
 * metadata.
 *
 * Throws `InvalidTransitionError` when the transition is not permitted.
 *
 * @param params - See `UpdateImportJobStatusParams`
 */
export async function updateImportJobStatus(params: UpdateImportJobStatusParams): Promise<void> {
  const { tenantId, importJobId, currentStatus, newStatus, progress, timestamp } = params;

  // Validate the transition before touching DynamoDB
  if (!isValidTransition(currentStatus, newStatus)) {
    throw new InvalidTransitionError(currentStatus, newStatus, importJobId);
  }

  const tableName = params.tableName ?? process.env['IMPORT_JOBS_TABLE'];
  if (!tableName) {
    throw new Error(
      'Import Jobs table name is required. Pass tableName or set the IMPORT_JOBS_TABLE environment variable.',
    );
  }

  const now = timestamp ?? new Date().toISOString();

  // Build the UpdateExpression dynamically so we only send populated fields
  const expressionAttributeNames: Record<string, string> = {
    '#status': 'status',
    '#updatedAt': 'updatedAt',
  };
  const expressionAttributeValues: Record<string, unknown> = {
    ':newStatus': newStatus,
    ':now': now,
    // Optimistic-lock guard: only allow update if current status matches
    ':currentStatus': currentStatus,
  };
  const updateParts: string[] = ['#status = :newStatus', '#updatedAt = :now'];

  // Attach progress metadata when provided
  if (progress !== undefined) {
    expressionAttributeNames['#progress'] = 'progress';
    expressionAttributeValues[':progress'] = progress;
    updateParts.push('#progress = :progress');
  }

  // Record startedAt when transitioning into active processing
  if (newStatus === 'PROCESSING') {
    expressionAttributeNames['#startedAt'] = 'startedAt';
    expressionAttributeValues[':startedAt'] = now;
    updateParts.push('#startedAt = :startedAt');
  }

  // Record completedAt when the job reaches a terminal state
  if (newStatus === 'COMPLETED' || newStatus === 'FAILED') {
    expressionAttributeNames['#completedAt'] = 'completedAt';
    expressionAttributeValues[':completedAt'] = now;
    updateParts.push('#completedAt = :completedAt');
  }

  const updateExpression = `SET ${updateParts.join(', ')}`;

  const docClient = getDynamoDocClient();

  await docClient.send(
    new UpdateCommand({
      TableName: tableName,
      Key: {
        PK: `TENANT#${tenantId}`,
        SK: `IMPORT#${importJobId}`,
      },
      UpdateExpression: updateExpression,
      // Conditional write: guard against concurrent state changes
      ConditionExpression: '#status = :currentStatus',
      ExpressionAttributeNames: expressionAttributeNames,
      ExpressionAttributeValues: expressionAttributeValues,
    }),
  );
}

// ---------------------------------------------------------------------------
// Error Types
// ---------------------------------------------------------------------------

/**
 * Thrown when `updateImportJobStatus` is called with a transition that is
 * not in the `VALID_TRANSITIONS` map.
 */
export class InvalidTransitionError extends Error {
  readonly from: ImportJobStatus;
  readonly to: ImportJobStatus;
  readonly importJobId: string;

  constructor(from: ImportJobStatus, to: ImportJobStatus, importJobId: string) {
    super(
      `Invalid import job status transition: "${from}" → "${to}" (importJobId: ${importJobId}). ` +
        `Valid transitions from "${from}": [${[...VALID_TRANSITIONS[from]].join(', ') || 'none'}]`,
    );
    this.name = 'InvalidTransitionError';
    this.from = from;
    this.to = to;
    this.importJobId = importJobId;
  }
}
