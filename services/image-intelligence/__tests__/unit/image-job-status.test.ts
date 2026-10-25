/**
 * Unit tests for the Image_Job status transition logic.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { DynamoDBDocumentClient } from '@aws-sdk/lib-dynamodb';
import {
  isValidTransition,
  updateImageJobStatus,
  setDynamoDocClient,
  resetDynamoDocClient,
  InvalidTransitionError,
} from '../../utils/image-job-status';

describe('isValidTransition', () => {
  it('permits the forward pipeline path', () => {
    expect(isValidTransition('QUEUED', 'PROCESSING')).toBe(true);
    expect(isValidTransition('PROCESSING', 'COMPLETED')).toBe(true);
  });

  it('permits moderation rejection and failures', () => {
    expect(isValidTransition('PROCESSING', 'REJECTED')).toBe(true);
    expect(isValidTransition('QUEUED', 'FAILED')).toBe(true);
    expect(isValidTransition('PROCESSING', 'FAILED')).toBe(true);
  });

  it('forbids transitions out of terminal states', () => {
    expect(isValidTransition('COMPLETED', 'PROCESSING')).toBe(false);
    expect(isValidTransition('FAILED', 'PROCESSING')).toBe(false);
    expect(isValidTransition('REJECTED', 'PROCESSING')).toBe(false);
  });

  it('forbids illegal skips', () => {
    expect(isValidTransition('QUEUED', 'COMPLETED')).toBe(false);
    expect(isValidTransition('QUEUED', 'REJECTED')).toBe(false);
  });
});

describe('updateImageJobStatus', () => {
  let sendSpy: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    sendSpy = vi.fn().mockResolvedValue({});
    setDynamoDocClient({ send: sendSpy } as unknown as DynamoDBDocumentClient);
  });

  afterEach(() => {
    resetDynamoDocClient();
    vi.restoreAllMocks();
  });

  it('issues a conditional UpdateCommand on a valid transition', async () => {
    await updateImageJobStatus({
      tableName: 'image-jobs-test',
      tenantId: 't1',
      imageJobId: 'j1',
      currentStatus: 'QUEUED',
      newStatus: 'PROCESSING',
    });
    expect(sendSpy).toHaveBeenCalledTimes(1);
    const input = sendSpy.mock.calls[0][0].input;
    expect(input.Key).toEqual({ PK: 'TENANT#t1', SK: 'IMAGEJOB#j1' });
    expect(input.ConditionExpression).toBe('#status = :currentStatus');
    expect(input.ExpressionAttributeValues[':newStatus']).toBe('PROCESSING');
  });

  it('throws InvalidTransitionError and does not call DynamoDB on an illegal transition', async () => {
    await expect(
      updateImageJobStatus({
        tableName: 'image-jobs-test',
        tenantId: 't1',
        imageJobId: 'j1',
        currentStatus: 'COMPLETED',
        newStatus: 'PROCESSING',
      }),
    ).rejects.toBeInstanceOf(InvalidTransitionError);
    expect(sendSpy).not.toHaveBeenCalled();
  });
});
