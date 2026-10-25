/**
 * Image Job Status Update Utility
 *
 * Enforces valid Image_Job status transitions and updates DynamoDB records.
 *
 * Valid transition paths:
 *   QUEUED → PROCESSING → COMPLETED
 *   QUEUED | PROCESSING → FAILED
 *   PROCESSING → REJECTED (moderation)
 *
 * Terminal states: COMPLETED, FAILED, REJECTED — no transitions out of these.
 *
 * Requirements: 2.3, 7.1
 */

import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { DynamoDBDocumentClient, UpdateCommand } from '@aws-sdk/lib-dynamodb';
import type { ImageJobStatus } from '../types/image.types';

// ---------------------------------------------------------------------------
// Transition Map
// ---------------------------------------------------------------------------

export const VALID_TRANSITIONS: Readonly<Record<ImageJobStatus, ReadonlySet<ImageJobStatus>>> = {
  QUEUED: new Set<ImageJobStatus>(['PROCESSING', 'FAILED']),
  PROCESSING: new Set<ImageJobStatus>(['COMPLETED', 'FAILED', 'REJECTED']),
  COMPLETED: new Set<ImageJobStatus>([]),
  FAILED: new Set<ImageJobStatus>([]),
  REJECTED: new Set<ImageJobStatus>([]),
};

/** Returns true when transitioning from `from` to `to` is permitted. */
export function isValidTransition(from: ImageJobStatus, to: ImageJobStatus): boolean {
  return VALID_TRANSITIONS[from].has(to);
}

// ---------------------------------------------------------------------------
// DynamoDB client singleton (test-injectable)
// ---------------------------------------------------------------------------

let ddbDocClient: DynamoDBDocumentClient | null = null;

function getDynamoDocClient(): DynamoDBDocumentClient {
  if (!ddbDocClient) {
    const client = new DynamoDBClient({
      region: process.env['AWS_REGION'] ?? 'eu-west-1',
    });
    ddbDocClient = DynamoDBDocumentClient.from(client);
  }
  return ddbDocClient;
}

/** Override the DynamoDB Document Client (used for testing). */
export function setDynamoDocClient(client: DynamoDBDocumentClient): void {
  ddbDocClient = client;
}

/** Reset the DynamoDB Document Client (used for test teardown). */
export function resetDynamoDocClient(): void {
  ddbDocClient = null;
}

// ---------------------------------------------------------------------------
// updateImageJobStatus
// ---------------------------------------------------------------------------

export interface UpdateImageJobStatusParams {
  /** DynamoDB table name (reads IMAGE_JOBS_TABLE env var if omitted). */
  tableName?: string;
  tenantId: string;
  imageJobId: string;
  /** Current status — the transition is validated from this value. */
  currentStatus: ImageJobStatus;
  /** Target status to transition to. */
  newStatus: ImageJobStatus;
  /** Optional ISO 8601 timestamp; defaults to now. */
  timestamp?: string;
}

/**
 * Validates and applies an Image_Job status transition with an optimistic-lock
 * conditional write (only updates if the stored status still matches `currentStatus`).
 *
 * @throws InvalidTransitionError when the transition is not permitted.
 */
export async function updateImageJobStatus(params: UpdateImageJobStatusParams): Promise<void> {
  const { tenantId, imageJobId, currentStatus, newStatus, timestamp } = params;

  if (!isValidTransition(currentStatus, newStatus)) {
    throw new InvalidTransitionError(currentStatus, newStatus, imageJobId);
  }

  const tableName = params.tableName ?? process.env['IMAGE_JOBS_TABLE'];
  if (!tableName) {
    throw new Error(
      'Image Jobs table name is required. Pass tableName or set the IMAGE_JOBS_TABLE environment variable.',
    );
  }

  const now = timestamp ?? new Date().toISOString();

  await getDynamoDocClient().send(
    new UpdateCommand({
      TableName: tableName,
      Key: {
        PK: `TENANT#${tenantId}`,
        SK: `IMAGEJOB#${imageJobId}`,
      },
      UpdateExpression: 'SET #status = :newStatus, #updatedAt = :now',
      ConditionExpression: '#status = :currentStatus',
      ExpressionAttributeNames: {
        '#status': 'status',
        '#updatedAt': 'updatedAt',
      },
      ExpressionAttributeValues: {
        ':newStatus': newStatus,
        ':now': now,
        ':currentStatus': currentStatus,
      },
    }),
  );
}

// ---------------------------------------------------------------------------
// Error Types
// ---------------------------------------------------------------------------

export class InvalidTransitionError extends Error {
  readonly from: ImageJobStatus;
  readonly to: ImageJobStatus;
  readonly imageJobId: string;

  constructor(from: ImageJobStatus, to: ImageJobStatus, imageJobId: string) {
    super(
      `Invalid image job status transition: "${from}" → "${to}" (imageJobId: ${imageJobId}). ` +
        `Valid transitions from "${from}": [${[...VALID_TRANSITIONS[from]].join(', ') || 'none'}]`,
    );
    this.name = 'InvalidTransitionError';
    this.from = from;
    this.to = to;
    this.imageJobId = imageJobId;
  }
}
