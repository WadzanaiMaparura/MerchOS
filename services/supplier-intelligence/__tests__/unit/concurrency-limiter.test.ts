/**
 * Unit tests for the tenant concurrency limiter utility.
 *
 * Tests cover:
 * - checkTenantConcurrency() allows when active count < limit
 * - checkTenantConcurrency() denies when active count >= limit
 * - Correct DynamoDB query shape (PK, SK prefix, filter expression)
 * - Handles paginated DynamoDB responses
 * - Missing table name error handling
 * - Custom concurrency limit override
 *
 * Requirements: 5.6
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { mockClient } from 'aws-sdk-client-mock';
import { DynamoDBDocumentClient, QueryCommand } from '@aws-sdk/lib-dynamodb';
import {
  checkTenantConcurrency,
  setDynamoDocClient,
  MAX_CONCURRENT_JOBS_PER_TENANT,
  ACTIVE_STATUSES,
} from '../../utils/concurrency-limiter';

// ---------------------------------------------------------------------------
// Setup
// ---------------------------------------------------------------------------

const ddbMock = mockClient(DynamoDBDocumentClient);

beforeEach(() => {
  ddbMock.reset();
  setDynamoDocClient(ddbMock as unknown as DynamoDBDocumentClient);
});

const baseParams = {
  tableName: 'test-import-jobs',
  tenantId: 'tenant-abc',
};

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

describe('constants', () => {
  it('MAX_CONCURRENT_JOBS_PER_TENANT is 5', () => {
    expect(MAX_CONCURRENT_JOBS_PER_TENANT).toBe(5);
  });

  it('ACTIVE_STATUSES includes PROCESSING, VALIDATING, PERSISTING', () => {
    expect(ACTIVE_STATUSES).toContain('PROCESSING');
    expect(ACTIVE_STATUSES).toContain('VALIDATING');
    expect(ACTIVE_STATUSES).toContain('PERSISTING');
    expect(ACTIVE_STATUSES).toHaveLength(3);
  });

  it('ACTIVE_STATUSES does not include terminal or initial states', () => {
    expect(ACTIVE_STATUSES).not.toContain('QUEUED');
    expect(ACTIVE_STATUSES).not.toContain('COMPLETED');
    expect(ACTIVE_STATUSES).not.toContain('FAILED');
  });
});

// ---------------------------------------------------------------------------
// checkTenantConcurrency — allowed scenarios
// ---------------------------------------------------------------------------

describe('checkTenantConcurrency — allowed', () => {
  it('returns allowed=true when no active jobs exist (count=0)', async () => {
    ddbMock.on(QueryCommand).resolves({ Count: 0, Items: [] });

    const result = await checkTenantConcurrency(baseParams);

    expect(result.allowed).toBe(true);
    expect(result.activeCount).toBe(0);
  });

  it('returns allowed=true when active count is below limit', async () => {
    ddbMock.on(QueryCommand).resolves({ Count: 3, Items: [] });

    const result = await checkTenantConcurrency(baseParams);

    expect(result.allowed).toBe(true);
    expect(result.activeCount).toBe(3);
  });

  it('returns allowed=true when active count is exactly limit - 1', async () => {
    ddbMock.on(QueryCommand).resolves({ Count: 4, Items: [] });

    const result = await checkTenantConcurrency(baseParams);

    expect(result.allowed).toBe(true);
    expect(result.activeCount).toBe(4);
  });
});

// ---------------------------------------------------------------------------
// checkTenantConcurrency — denied scenarios
// ---------------------------------------------------------------------------

describe('checkTenantConcurrency — denied', () => {
  it('returns allowed=false when active count equals the limit', async () => {
    ddbMock.on(QueryCommand).resolves({ Count: 5, Items: [] });

    const result = await checkTenantConcurrency(baseParams);

    expect(result.allowed).toBe(false);
    expect(result.activeCount).toBe(5);
  });

  it('returns allowed=false when active count exceeds the limit', async () => {
    ddbMock.on(QueryCommand).resolves({ Count: 7, Items: [] });

    const result = await checkTenantConcurrency(baseParams);

    expect(result.allowed).toBe(false);
    expect(result.activeCount).toBe(7);
  });
});

// ---------------------------------------------------------------------------
// DynamoDB query shape
// ---------------------------------------------------------------------------

describe('checkTenantConcurrency — DynamoDB query', () => {
  it('queries with PK = TENANT#{tenantId}', async () => {
    ddbMock.on(QueryCommand).resolves({ Count: 0, Items: [] });

    await checkTenantConcurrency({ ...baseParams, tenantId: 'tenant-xyz' });

    const calls = ddbMock.commandCalls(QueryCommand);
    expect(calls).toHaveLength(1);
    const input = calls[0].args[0].input;
    expect(input.ExpressionAttributeValues?.[':pk']).toBe('TENANT#tenant-xyz');
  });

  it('queries with SK begins_with IMPORT#', async () => {
    ddbMock.on(QueryCommand).resolves({ Count: 0, Items: [] });

    await checkTenantConcurrency(baseParams);

    const input = ddbMock.commandCalls(QueryCommand)[0].args[0].input;
    expect(input.KeyConditionExpression).toContain("begins_with(SK, :skPrefix)");
    expect(input.ExpressionAttributeValues?.[':skPrefix']).toBe('IMPORT#');
  });

  it('filters for active statuses (PROCESSING, VALIDATING, PERSISTING)', async () => {
    ddbMock.on(QueryCommand).resolves({ Count: 0, Items: [] });

    await checkTenantConcurrency(baseParams);

    const input = ddbMock.commandCalls(QueryCommand)[0].args[0].input;
    expect(input.FilterExpression).toContain('#status IN');
    expect(input.ExpressionAttributeValues?.[':s1']).toBe('PROCESSING');
    expect(input.ExpressionAttributeValues?.[':s2']).toBe('VALIDATING');
    expect(input.ExpressionAttributeValues?.[':s3']).toBe('PERSISTING');
  });

  it('uses SELECT COUNT to minimize data transfer', async () => {
    ddbMock.on(QueryCommand).resolves({ Count: 0, Items: [] });

    await checkTenantConcurrency(baseParams);

    const input = ddbMock.commandCalls(QueryCommand)[0].args[0].input;
    expect(input.Select).toBe('COUNT');
  });

  it('uses the provided tableName', async () => {
    ddbMock.on(QueryCommand).resolves({ Count: 0, Items: [] });

    await checkTenantConcurrency({ ...baseParams, tableName: 'my-custom-table' });

    const input = ddbMock.commandCalls(QueryCommand)[0].args[0].input;
    expect(input.TableName).toBe('my-custom-table');
  });
});

// ---------------------------------------------------------------------------
// Pagination handling
// ---------------------------------------------------------------------------

describe('checkTenantConcurrency — pagination', () => {
  it('accumulates counts across paginated responses', async () => {
    // First page returns 3 with a continuation key
    ddbMock
      .on(QueryCommand)
      .resolvesOnce({
        Count: 3,
        Items: [],
        LastEvaluatedKey: { PK: 'TENANT#tenant-abc', SK: 'IMPORT#job-3' },
      })
      // Second page returns 2 with no continuation
      .resolvesOnce({
        Count: 2,
        Items: [],
      });

    const result = await checkTenantConcurrency(baseParams);

    expect(result.activeCount).toBe(5);
    expect(result.allowed).toBe(false);
    expect(ddbMock.commandCalls(QueryCommand)).toHaveLength(2);
  });

  it('passes ExclusiveStartKey from previous response', async () => {
    const lastKey = { PK: 'TENANT#tenant-abc', SK: 'IMPORT#job-99' };

    ddbMock
      .on(QueryCommand)
      .resolvesOnce({ Count: 1, Items: [], LastEvaluatedKey: lastKey })
      .resolvesOnce({ Count: 0, Items: [] });

    await checkTenantConcurrency(baseParams);

    const calls = ddbMock.commandCalls(QueryCommand);
    expect(calls[1].args[0].input.ExclusiveStartKey).toEqual(lastKey);
  });
});

// ---------------------------------------------------------------------------
// Custom concurrency limit
// ---------------------------------------------------------------------------

describe('checkTenantConcurrency — custom limit', () => {
  it('allows when count is below custom limit', async () => {
    ddbMock.on(QueryCommand).resolves({ Count: 8, Items: [] });

    const result = await checkTenantConcurrency({ ...baseParams, maxConcurrent: 10 });

    expect(result.allowed).toBe(true);
    expect(result.activeCount).toBe(8);
  });

  it('denies when count equals custom limit', async () => {
    ddbMock.on(QueryCommand).resolves({ Count: 3, Items: [] });

    const result = await checkTenantConcurrency({ ...baseParams, maxConcurrent: 3 });

    expect(result.allowed).toBe(false);
    expect(result.activeCount).toBe(3);
  });
});

// ---------------------------------------------------------------------------
// Error handling
// ---------------------------------------------------------------------------

describe('checkTenantConcurrency — error handling', () => {
  it('throws when no tableName and IMPORT_JOBS_TABLE env var is unset', async () => {
    const originalEnv = process.env['IMPORT_JOBS_TABLE'];
    delete process.env['IMPORT_JOBS_TABLE'];

    await expect(
      checkTenantConcurrency({ tenantId: 'tenant-abc' }),
    ).rejects.toThrow('Import Jobs table name is required');

    process.env['IMPORT_JOBS_TABLE'] = originalEnv;
  });

  it('uses IMPORT_JOBS_TABLE env var when tableName is not provided', async () => {
    ddbMock.on(QueryCommand).resolves({ Count: 1, Items: [] });
    process.env['IMPORT_JOBS_TABLE'] = 'env-table-name';

    await checkTenantConcurrency({ tenantId: 'tenant-abc' });

    const input = ddbMock.commandCalls(QueryCommand)[0].args[0].input;
    expect(input.TableName).toBe('env-table-name');

    delete process.env['IMPORT_JOBS_TABLE'];
  });

  it('propagates DynamoDB errors', async () => {
    ddbMock.on(QueryCommand).rejects(new Error('DynamoDB timeout'));

    await expect(checkTenantConcurrency(baseParams)).rejects.toThrow('DynamoDB timeout');
  });
});
