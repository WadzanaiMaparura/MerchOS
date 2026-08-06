/**
 * Unit tests for import-job-status utility.
 *
 * Tests cover:
 * - VALID_TRANSITIONS map completeness
 * - isValidTransition() for every valid and invalid path
 * - updateImportJobStatus() — DynamoDB update shape, progress metadata,
 *   timestamp fields, invalid transition rejection, and missing table name
 *
 * Requirements: 5.5, 8.4
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { mockClient } from 'aws-sdk-client-mock';
import { DynamoDBDocumentClient, UpdateCommand } from '@aws-sdk/lib-dynamodb';
import {
  VALID_TRANSITIONS,
  isValidTransition,
  updateImportJobStatus,
  setDynamoDocClient,
  InvalidTransitionError,
} from '../../utils/import-job-status';
import type { ImportJobStatus } from '../../types/supplier.types';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const ALL_STATUSES: ImportJobStatus[] = [
  'QUEUED',
  'PROCESSING',
  'VALIDATING',
  'PERSISTING',
  'COMPLETED',
  'FAILED',
];

const ACTIVE_STATUSES: ImportJobStatus[] = ['QUEUED', 'PROCESSING', 'VALIDATING', 'PERSISTING'];

// ---------------------------------------------------------------------------
// VALID_TRANSITIONS map
// ---------------------------------------------------------------------------

describe('VALID_TRANSITIONS', () => {
  it('contains an entry for every ImportJobStatus', () => {
    for (const status of ALL_STATUSES) {
      expect(VALID_TRANSITIONS).toHaveProperty(status);
    }
  });

  it('maps QUEUED to PROCESSING and FAILED only', () => {
    expect([...VALID_TRANSITIONS.QUEUED]).toEqual(expect.arrayContaining(['PROCESSING', 'FAILED']));
    expect(VALID_TRANSITIONS.QUEUED.size).toBe(2);
  });

  it('maps PROCESSING to VALIDATING and FAILED only', () => {
    expect([...VALID_TRANSITIONS.PROCESSING]).toEqual(
      expect.arrayContaining(['VALIDATING', 'FAILED']),
    );
    expect(VALID_TRANSITIONS.PROCESSING.size).toBe(2);
  });

  it('maps VALIDATING to PERSISTING and FAILED only', () => {
    expect([...VALID_TRANSITIONS.VALIDATING]).toEqual(
      expect.arrayContaining(['PERSISTING', 'FAILED']),
    );
    expect(VALID_TRANSITIONS.VALIDATING.size).toBe(2);
  });

  it('maps PERSISTING to COMPLETED and FAILED only', () => {
    expect([...VALID_TRANSITIONS.PERSISTING]).toEqual(
      expect.arrayContaining(['COMPLETED', 'FAILED']),
    );
    expect(VALID_TRANSITIONS.PERSISTING.size).toBe(2);
  });

  it('COMPLETED is a terminal state with no valid exits', () => {
    expect(VALID_TRANSITIONS.COMPLETED.size).toBe(0);
  });

  it('FAILED is a terminal state with no valid exits', () => {
    expect(VALID_TRANSITIONS.FAILED.size).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// isValidTransition
// ---------------------------------------------------------------------------

describe('isValidTransition', () => {
  describe('valid forward transitions (happy path)', () => {
    const forwardPath: [ImportJobStatus, ImportJobStatus][] = [
      ['QUEUED', 'PROCESSING'],
      ['PROCESSING', 'VALIDATING'],
      ['VALIDATING', 'PERSISTING'],
      ['PERSISTING', 'COMPLETED'],
    ];

    it.each(forwardPath)('allows %s → %s', (from, to) => {
      expect(isValidTransition(from, to)).toBe(true);
    });
  });

  describe('any active state can fail', () => {
    it.each(ACTIVE_STATUSES)('%s → FAILED is valid', (active) => {
      expect(isValidTransition(active, 'FAILED')).toBe(true);
    });
  });

  describe('terminal states have no valid outgoing transitions', () => {
    it.each(ALL_STATUSES)('COMPLETED → %s is invalid', (to) => {
      expect(isValidTransition('COMPLETED', to)).toBe(false);
    });

    it.each(ALL_STATUSES)('FAILED → %s is invalid', (to) => {
      expect(isValidTransition('FAILED', to)).toBe(false);
    });
  });

  describe('regression / skipping steps is invalid', () => {
    const regressions: [ImportJobStatus, ImportJobStatus][] = [
      ['PROCESSING', 'QUEUED'],
      ['VALIDATING', 'QUEUED'],
      ['VALIDATING', 'PROCESSING'],
      ['PERSISTING', 'QUEUED'],
      ['PERSISTING', 'PROCESSING'],
      ['PERSISTING', 'VALIDATING'],
      ['COMPLETED', 'PERSISTING'],
    ];

    it.each(regressions)('rejects %s → %s (regression)', (from, to) => {
      expect(isValidTransition(from, to)).toBe(false);
    });
  });

  describe('skipping steps forward is invalid', () => {
    const skips: [ImportJobStatus, ImportJobStatus][] = [
      ['QUEUED', 'VALIDATING'],
      ['QUEUED', 'PERSISTING'],
      ['QUEUED', 'COMPLETED'],
      ['PROCESSING', 'PERSISTING'],
      ['PROCESSING', 'COMPLETED'],
      ['VALIDATING', 'COMPLETED'],
    ];

    it.each(skips)('rejects %s → %s (step skipped)', (from, to) => {
      expect(isValidTransition(from, to)).toBe(false);
    });
  });

  describe('self-transitions are invalid', () => {
    it.each(ALL_STATUSES)('%s → %s (self) is invalid', (status) => {
      expect(isValidTransition(status, status)).toBe(false);
    });
  });
});

// ---------------------------------------------------------------------------
// updateImportJobStatus — DynamoDB interactions
// ---------------------------------------------------------------------------

describe('updateImportJobStatus', () => {
  const ddbMock = mockClient(DynamoDBDocumentClient);

  beforeEach(() => {
    ddbMock.reset();
    // Inject mock into the utility via the exported setter
    setDynamoDocClient(ddbMock as unknown as DynamoDBDocumentClient);
  });

  const baseParams = {
    tableName: 'test-import-jobs',
    tenantId: 'tenant-123',
    importJobId: 'job-abc',
    currentStatus: 'QUEUED' as ImportJobStatus,
    newStatus: 'PROCESSING' as ImportJobStatus,
  };

  describe('valid transitions', () => {
    it('sends an UpdateCommand with correct Key (PK/SK)', async () => {
      ddbMock.on(UpdateCommand).resolves({});

      await updateImportJobStatus(baseParams);

      const calls = ddbMock.commandCalls(UpdateCommand);
      expect(calls).toHaveLength(1);
      const input = calls[0].args[0].input;
      expect(input.Key).toEqual({
        PK: 'TENANT#tenant-123',
        SK: 'IMPORT#job-abc',
      });
    });

    it('uses the provided tableName', async () => {
      ddbMock.on(UpdateCommand).resolves({});

      await updateImportJobStatus({ ...baseParams, tableName: 'my-custom-table' });

      const calls = ddbMock.commandCalls(UpdateCommand);
      expect(calls[0].args[0].input.TableName).toBe('my-custom-table');
    });

    it('sets status to the new value in ExpressionAttributeValues', async () => {
      ddbMock.on(UpdateCommand).resolves({});

      await updateImportJobStatus(baseParams);

      const input = ddbMock.commandCalls(UpdateCommand)[0].args[0].input;
      expect(input.ExpressionAttributeValues?.[':newStatus']).toBe('PROCESSING');
    });

    it('includes optimistic-lock condition on current status', async () => {
      ddbMock.on(UpdateCommand).resolves({});

      await updateImportJobStatus(baseParams);

      const input = ddbMock.commandCalls(UpdateCommand)[0].args[0].input;
      expect(input.ConditionExpression).toContain(':currentStatus');
      expect(input.ExpressionAttributeValues?.[':currentStatus']).toBe('QUEUED');
    });

    it('sets startedAt when transitioning to PROCESSING', async () => {
      ddbMock.on(UpdateCommand).resolves({});
      const ts = '2024-01-15T10:00:00.000Z';

      await updateImportJobStatus({ ...baseParams, timestamp: ts });

      const input = ddbMock.commandCalls(UpdateCommand)[0].args[0].input;
      expect(input.ExpressionAttributeValues?.[':startedAt']).toBe(ts);
      expect(input.UpdateExpression).toContain('#startedAt');
    });

    it('does NOT set startedAt for other active transitions', async () => {
      ddbMock.on(UpdateCommand).resolves({});

      await updateImportJobStatus({
        ...baseParams,
        currentStatus: 'PROCESSING',
        newStatus: 'VALIDATING',
      });

      const input = ddbMock.commandCalls(UpdateCommand)[0].args[0].input;
      expect(input.UpdateExpression).not.toContain('#startedAt');
    });

    it('sets completedAt when transitioning to COMPLETED', async () => {
      ddbMock.on(UpdateCommand).resolves({});
      const ts = '2024-01-15T11:00:00.000Z';

      await updateImportJobStatus({
        ...baseParams,
        currentStatus: 'PERSISTING',
        newStatus: 'COMPLETED',
        timestamp: ts,
      });

      const input = ddbMock.commandCalls(UpdateCommand)[0].args[0].input;
      expect(input.ExpressionAttributeValues?.[':completedAt']).toBe(ts);
      expect(input.UpdateExpression).toContain('#completedAt');
    });

    it('sets completedAt when transitioning to FAILED', async () => {
      ddbMock.on(UpdateCommand).resolves({});
      const ts = '2024-01-15T11:30:00.000Z';

      await updateImportJobStatus({
        ...baseParams,
        currentStatus: 'VALIDATING',
        newStatus: 'FAILED',
        timestamp: ts,
      });

      const input = ddbMock.commandCalls(UpdateCommand)[0].args[0].input;
      expect(input.ExpressionAttributeValues?.[':completedAt']).toBe(ts);
    });

    it('does NOT set completedAt for non-terminal transitions', async () => {
      ddbMock.on(UpdateCommand).resolves({});

      await updateImportJobStatus({
        ...baseParams,
        currentStatus: 'PROCESSING',
        newStatus: 'VALIDATING',
      });

      const input = ddbMock.commandCalls(UpdateCommand)[0].args[0].input;
      expect(input.UpdateExpression).not.toContain('#completedAt');
    });
  });

  describe('progress metadata', () => {
    it('includes progress in UpdateExpression when provided', async () => {
      ddbMock.on(UpdateCommand).resolves({});
      const progress = { percentage: 40, currentStep: 'Parsing CSV', estimatedTimeRemaining: 30 };

      await updateImportJobStatus({ ...baseParams, progress });

      const input = ddbMock.commandCalls(UpdateCommand)[0].args[0].input;
      expect(input.ExpressionAttributeValues?.[':progress']).toEqual(progress);
      expect(input.UpdateExpression).toContain('#progress');
    });

    it('omits progress from UpdateExpression when not provided', async () => {
      ddbMock.on(UpdateCommand).resolves({});

      await updateImportJobStatus(baseParams);

      const input = ddbMock.commandCalls(UpdateCommand)[0].args[0].input;
      expect(input.UpdateExpression).not.toContain('#progress');
    });

    it('handles progress without estimatedTimeRemaining', async () => {
      ddbMock.on(UpdateCommand).resolves({});
      const progress = { percentage: 75, currentStep: 'Validating records' };

      await updateImportJobStatus({ ...baseParams, progress });

      const input = ddbMock.commandCalls(UpdateCommand)[0].args[0].input;
      expect(input.ExpressionAttributeValues?.[':progress']).toEqual(progress);
    });
  });

  describe('invalid transitions', () => {
    it('throws InvalidTransitionError without calling DynamoDB', async () => {
      await expect(
        updateImportJobStatus({
          ...baseParams,
          currentStatus: 'COMPLETED',
          newStatus: 'PROCESSING',
        }),
      ).rejects.toThrow(InvalidTransitionError);

      expect(ddbMock.commandCalls(UpdateCommand)).toHaveLength(0);
    });

    it('error message includes from, to, and importJobId', async () => {
      let error: Error | null = null;
      try {
        await updateImportJobStatus({
          ...baseParams,
          currentStatus: 'FAILED',
          newStatus: 'QUEUED',
        });
      } catch (e) {
        error = e as Error;
      }

      expect(error).not.toBeNull();
      expect(error!.message).toContain('FAILED');
      expect(error!.message).toContain('QUEUED');
      expect(error!.message).toContain('job-abc');
    });

    it('throws for a self-transition', async () => {
      await expect(
        updateImportJobStatus({
          ...baseParams,
          currentStatus: 'PROCESSING',
          newStatus: 'PROCESSING',
        }),
      ).rejects.toThrow(InvalidTransitionError);
    });

    it('throws for skipping steps forward', async () => {
      await expect(
        updateImportJobStatus({
          ...baseParams,
          currentStatus: 'QUEUED',
          newStatus: 'VALIDATING',
        }),
      ).rejects.toThrow(InvalidTransitionError);
    });

    it('throws for regression to earlier state', async () => {
      await expect(
        updateImportJobStatus({
          ...baseParams,
          currentStatus: 'VALIDATING',
          newStatus: 'PROCESSING',
        }),
      ).rejects.toThrow(InvalidTransitionError);
    });
  });

  describe('missing table name', () => {
    it('throws when no tableName and IMPORT_JOBS_TABLE env var is unset', async () => {
      const originalEnv = process.env['IMPORT_JOBS_TABLE'];
      delete process.env['IMPORT_JOBS_TABLE'];

      await expect(
        updateImportJobStatus({ ...baseParams, tableName: undefined }),
      ).rejects.toThrow('Import Jobs table name is required');

      process.env['IMPORT_JOBS_TABLE'] = originalEnv;
    });

    it('uses IMPORT_JOBS_TABLE env var when no tableName is provided', async () => {
      ddbMock.on(UpdateCommand).resolves({});
      process.env['IMPORT_JOBS_TABLE'] = 'env-import-jobs-table';

      await updateImportJobStatus({ ...baseParams, tableName: undefined });

      const input = ddbMock.commandCalls(UpdateCommand)[0].args[0].input;
      expect(input.TableName).toBe('env-import-jobs-table');

      delete process.env['IMPORT_JOBS_TABLE'];
    });
  });
});

// ---------------------------------------------------------------------------
// InvalidTransitionError
// ---------------------------------------------------------------------------

describe('InvalidTransitionError', () => {
  it('is an instance of Error', () => {
    const err = new InvalidTransitionError('COMPLETED', 'QUEUED', 'job-xyz');
    expect(err).toBeInstanceOf(Error);
  });

  it('has name "InvalidTransitionError"', () => {
    const err = new InvalidTransitionError('COMPLETED', 'QUEUED', 'job-xyz');
    expect(err.name).toBe('InvalidTransitionError');
  });

  it('exposes from, to, and importJobId properties', () => {
    const err = new InvalidTransitionError('FAILED', 'PROCESSING', 'job-123');
    expect(err.from).toBe('FAILED');
    expect(err.to).toBe('PROCESSING');
    expect(err.importJobId).toBe('job-123');
  });

  it('includes valid transitions in the message for non-terminal states', () => {
    const err = new InvalidTransitionError('QUEUED', 'COMPLETED', 'job-999');
    expect(err.message).toContain('PROCESSING');
    expect(err.message).toContain('FAILED');
  });

  it('mentions "none" in the message for terminal states', () => {
    const err = new InvalidTransitionError('COMPLETED', 'QUEUED', 'job-999');
    expect(err.message).toContain('none');
  });
});
