/**
 * Unit tests for the Bedrock Client service.
 *
 * Tests retry logic, token tracking, latency measurement,
 * and EventBridge failure event emission.
 *
 * @see Requirements 14.1, 14.2, 14.3, 14.4, 14.5
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { mockClient } from 'aws-sdk-client-mock';
import { InvokeModelCommand, BedrockRuntimeClient } from '@aws-sdk/client-bedrock-runtime';
import { PutEventsCommand, EventBridgeClient } from '@aws-sdk/client-eventbridge';

import {
  BedrockClient,
  calculateBackoff,
  applyFullJitter,
  isRetryableError,
  resetClientsForTesting,
  type BedrockInvocationParams,
  type BedrockUnavailableError,
} from '../../services/bedrock-client';

// ---------------------------------------------------------------------------
// Mocks
// ---------------------------------------------------------------------------

const bedrockMock = mockClient(BedrockRuntimeClient);
const eventBridgeMock = mockClient(EventBridgeClient);

function buildSuccessResponse(content = 'Generated content', inputTokens = 50, outputTokens = 20) {
  return {
    body: new TextEncoder().encode(
      JSON.stringify({
        content: [{ text: content }],
        usage: { input_tokens: inputTokens, output_tokens: outputTokens },
      }),
    ),
  };
}

function buildParams(overrides?: Partial<BedrockInvocationParams>): BedrockInvocationParams {
  return {
    modelId: 'anthropic.claude-3-haiku-20240307-v1:0',
    prompt: 'Generate a title for a blue widget',
    maxTokens: 100,
    ...overrides,
  };
}

function createThrottlingError() {
  const error = new Error('Rate exceeded');
  error.name = 'ThrottlingException';
  return error;
}

function createServiceUnavailableError() {
  const error = new Error('Service temporarily unavailable');
  error.name = 'ServiceUnavailableException';
  return error;
}

function createInternalServerError() {
  const error = new Error('Internal server error');
  error.name = 'InternalServerError';
  return error;
}

function createNonRetryableError() {
  const error = new Error('Validation error');
  error.name = 'ValidationException';
  return error;
}

// ---------------------------------------------------------------------------
// Setup
// ---------------------------------------------------------------------------

beforeEach(() => {
  bedrockMock.reset();
  eventBridgeMock.reset();
  resetClientsForTesting();
  vi.restoreAllMocks();
  process.env['EVENT_BUS_NAME'] = 'test-event-bus';
});

// ---------------------------------------------------------------------------
// calculateBackoff tests
// ---------------------------------------------------------------------------

describe('calculateBackoff', () => {
  it('should calculate backoff for attempt 1 as initial * multiplier^1 = 2000ms', () => {
    expect(calculateBackoff(1)).toBe(2000);
  });

  it('should calculate backoff for attempt 2 as initial * multiplier^2 = 4000ms', () => {
    expect(calculateBackoff(2)).toBe(4000);
  });

  it('should calculate backoff for attempt 3 as initial * multiplier^3 = 8000ms', () => {
    expect(calculateBackoff(3)).toBe(8000);
  });

  it('should cap backoff at maxBackoffMs (10000ms)', () => {
    expect(calculateBackoff(4)).toBe(10000);
    expect(calculateBackoff(10)).toBe(10000);
  });

  it('should use custom retry config when provided', () => {
    const config = { maxRetries: 3, initialBackoffMs: 500, multiplier: 3, maxBackoffMs: 5000 };
    expect(calculateBackoff(1, config)).toBe(1500); // 500 * 3^1
    expect(calculateBackoff(2, config)).toBe(4500); // 500 * 3^2
    expect(calculateBackoff(3, config)).toBe(5000); // capped at 5000
  });
});

// ---------------------------------------------------------------------------
// applyFullJitter tests
// ---------------------------------------------------------------------------

describe('applyFullJitter', () => {
  it('should return 0 when random returns 0', () => {
    expect(applyFullJitter(2000, () => 0)).toBe(0);
  });

  it('should return the full backoff when random returns 1', () => {
    expect(applyFullJitter(2000, () => 1)).toBe(2000);
  });

  it('should return half the backoff when random returns 0.5', () => {
    expect(applyFullJitter(4000, () => 0.5)).toBe(2000);
  });

  it('should always return a value in [0, calculatedBackoff]', () => {
    for (let i = 0; i < 100; i++) {
      const result = applyFullJitter(5000);
      expect(result).toBeGreaterThanOrEqual(0);
      expect(result).toBeLessThanOrEqual(5000);
    }
  });
});

// ---------------------------------------------------------------------------
// isRetryableError tests
// ---------------------------------------------------------------------------

describe('isRetryableError', () => {
  it('should return true for ThrottlingException', () => {
    expect(isRetryableError(createThrottlingError())).toBe(true);
  });

  it('should return true for ServiceUnavailableException', () => {
    expect(isRetryableError(createServiceUnavailableError())).toBe(true);
  });

  it('should return true for InternalServerError', () => {
    expect(isRetryableError(createInternalServerError())).toBe(true);
  });

  it('should return false for ValidationException', () => {
    expect(isRetryableError(createNonRetryableError())).toBe(false);
  });

  it('should return false for null', () => {
    expect(isRetryableError(null)).toBe(false);
  });

  it('should return false for undefined', () => {
    expect(isRetryableError(undefined)).toBe(false);
  });

  it('should return false for plain strings', () => {
    expect(isRetryableError('some error')).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// BedrockClient.invoke - Successful invocation
// ---------------------------------------------------------------------------

describe('BedrockClient.invoke - success', () => {
  it('should return content, token counts, model ID, and latency on success', async () => {
    bedrockMock.on(InvokeModelCommand).resolves(buildSuccessResponse('Great Title', 75, 15));

    const client = new BedrockClient({ sleepFn: async () => {} });
    const result = await client.invoke(buildParams());

    expect(result.content).toBe('Great Title');
    expect(result.inputTokens).toBe(75);
    expect(result.outputTokens).toBe(15);
    expect(result.modelId).toBe('anthropic.claude-3-haiku-20240307-v1:0');
    expect(result.latencyMs).toBeGreaterThanOrEqual(0);
  });

  it('should pass temperature, topP, and stopSequences to the model', async () => {
    bedrockMock.on(InvokeModelCommand).resolves(buildSuccessResponse());

    const client = new BedrockClient({ sleepFn: async () => {} });
    await client.invoke(
      buildParams({ temperature: 0.7, topP: 0.9, stopSequences: ['\n'] }),
    );

    const call = bedrockMock.calls()[0];
    const body = JSON.parse(new TextDecoder().decode(call.args[0].input.body));

    expect(body.temperature).toBe(0.7);
    expect(body.top_p).toBe(0.9);
    expect(body.stop_sequences).toEqual(['\n']);
  });

  it('should not include optional params when not provided', async () => {
    bedrockMock.on(InvokeModelCommand).resolves(buildSuccessResponse());

    const client = new BedrockClient({ sleepFn: async () => {} });
    await client.invoke(buildParams());

    const call = bedrockMock.calls()[0];
    const body = JSON.parse(new TextDecoder().decode(call.args[0].input.body));

    expect(body.temperature).toBeUndefined();
    expect(body.top_p).toBeUndefined();
    expect(body.stop_sequences).toBeUndefined();
  });
});

// ---------------------------------------------------------------------------
// BedrockClient.invoke - Retry behavior
// ---------------------------------------------------------------------------

describe('BedrockClient.invoke - retry behavior', () => {
  it('should retry on ThrottlingException and succeed', async () => {
    bedrockMock
      .on(InvokeModelCommand)
      .rejectsOnce(createThrottlingError())
      .resolves(buildSuccessResponse('Retried content'));

    const client = new BedrockClient({ sleepFn: async () => {} });
    const result = await client.invoke(buildParams());

    expect(result.content).toBe('Retried content');
    expect(bedrockMock.calls()).toHaveLength(2);
  });

  it('should retry on ServiceUnavailableException and succeed', async () => {
    bedrockMock
      .on(InvokeModelCommand)
      .rejectsOnce(createServiceUnavailableError())
      .resolves(buildSuccessResponse('Recovered'));

    const client = new BedrockClient({ sleepFn: async () => {} });
    const result = await client.invoke(buildParams());

    expect(result.content).toBe('Recovered');
  });

  it('should retry on InternalServerError and succeed', async () => {
    bedrockMock
      .on(InvokeModelCommand)
      .rejectsOnce(createInternalServerError())
      .resolves(buildSuccessResponse('OK'));

    const client = new BedrockClient({ sleepFn: async () => {} });
    const result = await client.invoke(buildParams());

    expect(result.content).toBe('OK');
  });

  it('should retry up to 3 times (4 total attempts) before failing', async () => {
    bedrockMock.on(InvokeModelCommand).rejects(createThrottlingError());
    eventBridgeMock.on(PutEventsCommand).resolves({});

    const client = new BedrockClient({ sleepFn: async () => {} });

    await expect(client.invoke(buildParams())).rejects.toMatchObject({
      code: 'BEDROCK_UNAVAILABLE',
    });

    // 1 initial + 3 retries = 4 total
    expect(bedrockMock.calls()).toHaveLength(4);
  });

  it('should NOT retry on non-retryable errors', async () => {
    bedrockMock.on(InvokeModelCommand).rejects(createNonRetryableError());
    eventBridgeMock.on(PutEventsCommand).resolves({});

    const client = new BedrockClient({ sleepFn: async () => {} });

    await expect(client.invoke(buildParams())).rejects.toMatchObject({
      code: 'BEDROCK_UNAVAILABLE',
    });

    // Only 1 attempt, no retries
    expect(bedrockMock.calls()).toHaveLength(1);
  });

  it('should call sleepFn with jittered delay between retries', async () => {
    bedrockMock
      .on(InvokeModelCommand)
      .rejectsOnce(createThrottlingError())
      .rejectsOnce(createThrottlingError())
      .resolves(buildSuccessResponse());

    const sleepFn = vi.fn().mockResolvedValue(undefined);
    // Fixed random for predictable jitter: 0.5 * backoff
    const client = new BedrockClient({ sleepFn, randomFn: () => 0.5 });
    await client.invoke(buildParams());

    expect(sleepFn).toHaveBeenCalledTimes(2);
    // Attempt 1 retry: backoff = 1000 * 2^1 = 2000, jitter = 0.5 * 2000 = 1000
    expect(sleepFn).toHaveBeenNthCalledWith(1, 1000);
    // Attempt 2 retry: backoff = 1000 * 2^2 = 4000, jitter = 0.5 * 4000 = 2000
    expect(sleepFn).toHaveBeenNthCalledWith(2, 2000);
  });
});

// ---------------------------------------------------------------------------
// BedrockClient.invoke - EventBridge failure emission
// ---------------------------------------------------------------------------

describe('BedrockClient.invoke - failure event', () => {
  it('should emit bedrock-failure event when all retries exhausted', async () => {
    bedrockMock.on(InvokeModelCommand).rejects(createThrottlingError());
    eventBridgeMock.on(PutEventsCommand).resolves({});

    const client = new BedrockClient({ sleepFn: async () => {} });

    try {
      await client.invoke(buildParams());
    } catch {
      // expected
    }

    expect(eventBridgeMock.calls()).toHaveLength(1);
    const putEventsCall = eventBridgeMock.calls()[0];
    const entry = putEventsCall.args[0].input.Entries![0];

    expect(entry.Source).toBe('merch-os.product-intelligence');
    expect(entry.DetailType).toBe('product-intelligence.bedrock-failure');
    expect(entry.EventBusName).toBe('test-event-bus');

    const detail = JSON.parse(entry.Detail!);
    expect(detail.modelId).toBe('anthropic.claude-3-haiku-20240307-v1:0');
    expect(detail.attempts).toBe(4);
    expect(detail.lastError).toBe('Rate exceeded');
    expect(detail.timestamp).toBeDefined();
  });

  it('should not emit event when EVENT_BUS_NAME is not set', async () => {
    delete process.env['EVENT_BUS_NAME'];
    bedrockMock.on(InvokeModelCommand).rejects(createThrottlingError());

    const client = new BedrockClient({ sleepFn: async () => {} });

    try {
      await client.invoke(buildParams());
    } catch {
      // expected
    }

    expect(eventBridgeMock.calls()).toHaveLength(0);
  });

  it('should include proper error details in the thrown error', async () => {
    bedrockMock.on(InvokeModelCommand).rejects(createThrottlingError());
    eventBridgeMock.on(PutEventsCommand).resolves({});

    const client = new BedrockClient({ sleepFn: async () => {} });

    let thrownError: BedrockUnavailableError | undefined;
    try {
      await client.invoke(buildParams());
    } catch (err) {
      thrownError = err as BedrockUnavailableError;
    }

    expect(thrownError).toBeDefined();
    expect(thrownError!.code).toBe('BEDROCK_UNAVAILABLE');
    expect(thrownError!.modelId).toBe('anthropic.claude-3-haiku-20240307-v1:0');
    expect(thrownError!.attempts).toBe(4);
    expect(thrownError!.message).toContain('4 attempts');
    expect(thrownError!.lastError).toBe('Rate exceeded');
  });
});
