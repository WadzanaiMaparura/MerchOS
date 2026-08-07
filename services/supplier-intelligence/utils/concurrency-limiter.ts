/**
 * Tenant Concurrency Limiter
 *
 * Queries the Import Jobs table for active jobs (PROCESSING, VALIDATING, PERSISTING)
 * belonging to a given tenant and enforces a maximum concurrency limit of 5 simultaneous
 * Import_Jobs per tenant. When the limit is reached, the caller (import-queue-consumer)
 * should NOT start a new execution, allowing the SQS message visibility timeout to expire
 * so the message is retried later.
 *
 * @see Requirements 5.6
 */

import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { DynamoDBDocumentClient, QueryCommand } from '@aws-sdk/lib-dynamodb';
import type { ImportJobStatus } from '../types/supplier.types';

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

/** Maximum number of simultaneous import jobs allowed per tenant. */
export const MAX_CONCURRENT_JOBS_PER_TENANT = 5;

/** Statuses that count as "active" for concurrency purposes. */
export const ACTIVE_STATUSES: readonly ImportJobStatus[] = [
  'PROCESSING',
  'VALIDATING',
  'PERSISTING',
];

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface CheckTenantConcurrencyParams {
  /** Tenant identifier (used as DynamoDB PK: TENANT#{tenantId}) */
  tenantId: string;
  /** DynamoDB table name — falls back to IMPORT_JOBS_TABLE env var if omitted */
  tableName?: string;
  /** Optional override for concurrency limit (defaults to MAX_CONCURRENT_JOBS_PER_TENANT) */
  maxConcurrent?: number;
}

export interface CheckTenantConcurrencyResult {
  /** Whether the tenant is allowed to start a new import job */
  allowed: boolean;
  /** Current count of active import jobs for this tenant */
  activeCount: number;
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
// checkTenantConcurrency
// ---------------------------------------------------------------------------

/**
 * Queries the Import Jobs table for active import jobs belonging to a tenant
 * and determines whether a new execution is allowed.
 *
 * Active jobs are those with status IN (PROCESSING, VALIDATING, PERSISTING).
 * If the count of active jobs is >= the concurrency limit, the result will
 * indicate that the new job is NOT allowed to start.
 *
 * @param params - Concurrency check parameters
 * @returns Object with `allowed` flag and `activeCount`
 */
export async function checkTenantConcurrency(
  params: CheckTenantConcurrencyParams,
): Promise<CheckTenantConcurrencyResult> {
  const { tenantId, maxConcurrent = MAX_CONCURRENT_JOBS_PER_TENANT } = params;

  const tableName = params.tableName ?? process.env['IMPORT_JOBS_TABLE'];
  if (!tableName) {
    throw new Error(
      'Import Jobs table name is required. Pass tableName or set the IMPORT_JOBS_TABLE environment variable.',
    );
  }

  const activeCount = await queryActiveJobCount(tableName, tenantId);

  return {
    allowed: activeCount < maxConcurrent,
    activeCount,
  };
}

// ---------------------------------------------------------------------------
// Internal — Query active jobs
// ---------------------------------------------------------------------------

/**
 * Queries DynamoDB for import jobs with active statuses for the given tenant.
 *
 * Uses a query on the main table with PK = TENANT#{tenantId} and SK begins_with IMPORT#,
 * filtering for active statuses. We use a SELECT COUNT to minimize data transfer.
 */
async function queryActiveJobCount(tableName: string, tenantId: string): Promise<number> {
  const docClient = getDynamoDocClient();

  let totalCount = 0;
  let lastEvaluatedKey: Record<string, unknown> | undefined;

  // Paginate through results in case there are many import jobs for this tenant
  do {
    const response = await docClient.send(
      new QueryCommand({
        TableName: tableName,
        KeyConditionExpression: 'PK = :pk AND begins_with(SK, :skPrefix)',
        FilterExpression: '#status IN (:s1, :s2, :s3)',
        ExpressionAttributeNames: {
          '#status': 'status',
        },
        ExpressionAttributeValues: {
          ':pk': `TENANT#${tenantId}`,
          ':skPrefix': 'IMPORT#',
          ':s1': 'PROCESSING',
          ':s2': 'VALIDATING',
          ':s3': 'PERSISTING',
        },
        Select: 'COUNT',
        ExclusiveStartKey: lastEvaluatedKey,
      }),
    );

    totalCount += response.Count ?? 0;
    lastEvaluatedKey = response.LastEvaluatedKey as Record<string, unknown> | undefined;
  } while (lastEvaluatedKey);

  return totalCount;
}
