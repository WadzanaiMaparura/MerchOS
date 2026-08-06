/**
 * Unit tests for the supplier-intelligence event-emitter utility.
 *
 * Tests cover:
 * - getEventBridgeClient singleton and reset behaviour
 * - emitImportJobCompleted — PutEventsCommand shape, detail payload, error cases
 * - emitImportJobFailed    — PutEventsCommand shape, detail payload, error cases
 *
 * Requirements: 8.1, 8.2
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mockClient } from 'aws-sdk-client-mock';
import {
  EventBridgeClient,
  PutEventsCommand,
} from '@aws-sdk/client-eventbridge';
import {
  emitImportJobCompleted,
  emitImportJobFailed,
  getEventBridgeClient,
  resetForTesting,
  type EmitImportJobCompletedParams,
  type EmitImportJobFailedParams,
} from '../../utils/event-emitter';
import { SUPPLIER_INTELLIGENCE_EVENT_SOURCE } from '../../types/events.types';

const ebMock = mockClient(EventBridgeClient);

// ---------------------------------------------------------------------------
// Shared fixtures
// ---------------------------------------------------------------------------

const completedParams: EmitImportJobCompletedParams = {
  tenantId: 'tenant-abc',
  importJobId: 'job-001',
  supplierId: 'supplier-xyz',
  sourceType: 'FILE_CSV',
  results: {
    totalExtracted: 100,
    created: 80,
    updated: 15,
    duplicates: 5,
    validationFailed: 5,
  },
  durationMs: 12345,
};

const failedParams: EmitImportJobFailedParams = {
  tenantId: 'tenant-abc',
  importJobId: 'job-002',
  supplierId: 'supplier-xyz',
  error: {
    code: 'PARSE_ERROR',
    message: 'Failed to parse CSV: unexpected end of file',
  },
};

// ---------------------------------------------------------------------------
// Setup / teardown
// ---------------------------------------------------------------------------

beforeEach(() => {
  ebMock.reset();
  resetForTesting();
  process.env['EVENT_BUS_NAME'] = 'merch-os-events-test';
  process.env['AWS_REGION'] = 'af-south-1';
});

afterEach(() => {
  delete process.env['EVENT_BUS_NAME'];
  delete process.env['AWS_REGION'];
});

// ---------------------------------------------------------------------------
// getEventBridgeClient
// ---------------------------------------------------------------------------

describe('getEventBridgeClient', () => {
  it('returns the same instance on repeated calls (singleton)', () => {
    const c1 = getEventBridgeClient();
    const c2 = getEventBridgeClient();
    expect(c1).toBe(c2);
  });

  it('returns a new instance after resetForTesting', () => {
    const c1 = getEventBridgeClient();
    resetForTesting();
    const c2 = getEventBridgeClient();
    expect(c1).not.toBe(c2);
  });
});

// ---------------------------------------------------------------------------
// emitImportJobCompleted
// ---------------------------------------------------------------------------

describe('emitImportJobCompleted', () => {
  it('throws when EVENT_BUS_NAME is not set', async () => {
    delete process.env['EVENT_BUS_NAME'];

    await expect(emitImportJobCompleted(completedParams)).rejects.toThrow(
      'EVENT_BUS_NAME environment variable is not set',
    );
  });

  it('sends exactly one PutEventsCommand', async () => {
    ebMock.on(PutEventsCommand).resolves({ FailedEntryCount: 0, Entries: [{ EventId: 'e-1' }] });

    await emitImportJobCompleted(completedParams);

    const calls = ebMock.commandCalls(PutEventsCommand);
    expect(calls).toHaveLength(1);
    expect(calls[0].args[0].input.Entries).toHaveLength(1);
  });

  it('sets Source to the supplier-intelligence event source constant', async () => {
    ebMock.on(PutEventsCommand).resolves({ FailedEntryCount: 0, Entries: [{}] });

    await emitImportJobCompleted(completedParams);

    const entry = ebMock.commandCalls(PutEventsCommand)[0].args[0].input.Entries![0];
    expect(entry.Source).toBe(SUPPLIER_INTELLIGENCE_EVENT_SOURCE);
    expect(entry.Source).toBe('merch-os.supplier-intelligence');
  });

  it('sets DetailType to "ImportJobCompleted"', async () => {
    ebMock.on(PutEventsCommand).resolves({ FailedEntryCount: 0, Entries: [{}] });

    await emitImportJobCompleted(completedParams);

    const entry = ebMock.commandCalls(PutEventsCommand)[0].args[0].input.Entries![0];
    expect(entry.DetailType).toBe('ImportJobCompleted');
  });

  it('uses the EVENT_BUS_NAME env var as the EventBusName', async () => {
    ebMock.on(PutEventsCommand).resolves({ FailedEntryCount: 0, Entries: [{}] });

    await emitImportJobCompleted(completedParams);

    const entry = ebMock.commandCalls(PutEventsCommand)[0].args[0].input.Entries![0];
    expect(entry.EventBusName).toBe('merch-os-events-test');
  });

  it('includes Time field as a Date instance', async () => {
    ebMock.on(PutEventsCommand).resolves({ FailedEntryCount: 0, Entries: [{}] });

    await emitImportJobCompleted(completedParams);

    const entry = ebMock.commandCalls(PutEventsCommand)[0].args[0].input.Entries![0];
    expect(entry.Time).toBeInstanceOf(Date);
  });

  it('encodes the correct detail payload as JSON', async () => {
    ebMock.on(PutEventsCommand).resolves({ FailedEntryCount: 0, Entries: [{}] });

    await emitImportJobCompleted(completedParams);

    const entry = ebMock.commandCalls(PutEventsCommand)[0].args[0].input.Entries![0];
    const detail = JSON.parse(entry.Detail!);

    expect(detail.tenantId).toBe(completedParams.tenantId);
    expect(detail.importJobId).toBe(completedParams.importJobId);
    expect(detail.supplierId).toBe(completedParams.supplierId);
    expect(detail.sourceType).toBe(completedParams.sourceType);
    expect(detail.durationMs).toBe(completedParams.durationMs);
    expect(detail.results).toEqual(completedParams.results);
  });

  it('encodes all results summary fields in the detail', async () => {
    ebMock.on(PutEventsCommand).resolves({ FailedEntryCount: 0, Entries: [{}] });

    await emitImportJobCompleted(completedParams);

    const entry = ebMock.commandCalls(PutEventsCommand)[0].args[0].input.Entries![0];
    const detail = JSON.parse(entry.Detail!);

    expect(detail.results.totalExtracted).toBe(100);
    expect(detail.results.created).toBe(80);
    expect(detail.results.updated).toBe(15);
    expect(detail.results.duplicates).toBe(5);
    expect(detail.results.validationFailed).toBe(5);
  });

  it('returns the PutEvents response from EventBridge', async () => {
    const mockResponse = {
      FailedEntryCount: 0,
      Entries: [{ EventId: 'evt-completed-001' }],
    };
    ebMock.on(PutEventsCommand).resolves(mockResponse);

    const result = await emitImportJobCompleted(completedParams);

    expect(result.FailedEntryCount).toBe(0);
    expect(result.Entries![0].EventId).toBe('evt-completed-001');
  });

  it('handles zero-count results (empty import job)', async () => {
    ebMock.on(PutEventsCommand).resolves({ FailedEntryCount: 0, Entries: [{}] });

    const emptyResults: EmitImportJobCompletedParams = {
      ...completedParams,
      results: {
        totalExtracted: 0,
        created: 0,
        updated: 0,
        duplicates: 0,
        validationFailed: 0,
      },
      durationMs: 500,
    };

    await emitImportJobCompleted(emptyResults);

    const entry = ebMock.commandCalls(PutEventsCommand)[0].args[0].input.Entries![0];
    const detail = JSON.parse(entry.Detail!);
    expect(detail.results.totalExtracted).toBe(0);
    expect(detail.durationMs).toBe(500);
  });

  it('works with URL sourceType', async () => {
    ebMock.on(PutEventsCommand).resolves({ FailedEntryCount: 0, Entries: [{}] });

    await emitImportJobCompleted({ ...completedParams, sourceType: 'URL' });

    const entry = ebMock.commandCalls(PutEventsCommand)[0].args[0].input.Entries![0];
    const detail = JSON.parse(entry.Detail!);
    expect(detail.sourceType).toBe('URL');
  });
});

// ---------------------------------------------------------------------------
// emitImportJobFailed
// ---------------------------------------------------------------------------

describe('emitImportJobFailed', () => {
  it('throws when EVENT_BUS_NAME is not set', async () => {
    delete process.env['EVENT_BUS_NAME'];

    await expect(emitImportJobFailed(failedParams)).rejects.toThrow(
      'EVENT_BUS_NAME environment variable is not set',
    );
  });

  it('sends exactly one PutEventsCommand', async () => {
    ebMock.on(PutEventsCommand).resolves({ FailedEntryCount: 0, Entries: [{ EventId: 'e-2' }] });

    await emitImportJobFailed(failedParams);

    const calls = ebMock.commandCalls(PutEventsCommand);
    expect(calls).toHaveLength(1);
    expect(calls[0].args[0].input.Entries).toHaveLength(1);
  });

  it('sets Source to the supplier-intelligence event source constant', async () => {
    ebMock.on(PutEventsCommand).resolves({ FailedEntryCount: 0, Entries: [{}] });

    await emitImportJobFailed(failedParams);

    const entry = ebMock.commandCalls(PutEventsCommand)[0].args[0].input.Entries![0];
    expect(entry.Source).toBe(SUPPLIER_INTELLIGENCE_EVENT_SOURCE);
    expect(entry.Source).toBe('merch-os.supplier-intelligence');
  });

  it('sets DetailType to "ImportJobFailed"', async () => {
    ebMock.on(PutEventsCommand).resolves({ FailedEntryCount: 0, Entries: [{}] });

    await emitImportJobFailed(failedParams);

    const entry = ebMock.commandCalls(PutEventsCommand)[0].args[0].input.Entries![0];
    expect(entry.DetailType).toBe('ImportJobFailed');
  });

  it('uses the EVENT_BUS_NAME env var as the EventBusName', async () => {
    ebMock.on(PutEventsCommand).resolves({ FailedEntryCount: 0, Entries: [{}] });

    await emitImportJobFailed(failedParams);

    const entry = ebMock.commandCalls(PutEventsCommand)[0].args[0].input.Entries![0];
    expect(entry.EventBusName).toBe('merch-os-events-test');
  });

  it('includes Time field as a Date instance', async () => {
    ebMock.on(PutEventsCommand).resolves({ FailedEntryCount: 0, Entries: [{}] });

    await emitImportJobFailed(failedParams);

    const entry = ebMock.commandCalls(PutEventsCommand)[0].args[0].input.Entries![0];
    expect(entry.Time).toBeInstanceOf(Date);
  });

  it('encodes the correct detail payload as JSON', async () => {
    ebMock.on(PutEventsCommand).resolves({ FailedEntryCount: 0, Entries: [{}] });

    await emitImportJobFailed(failedParams);

    const entry = ebMock.commandCalls(PutEventsCommand)[0].args[0].input.Entries![0];
    const detail = JSON.parse(entry.Detail!);

    expect(detail.tenantId).toBe(failedParams.tenantId);
    expect(detail.importJobId).toBe(failedParams.importJobId);
    expect(detail.supplierId).toBe(failedParams.supplierId);
    expect(detail.error).toEqual(failedParams.error);
  });

  it('encodes both error.code and error.message in the detail', async () => {
    ebMock.on(PutEventsCommand).resolves({ FailedEntryCount: 0, Entries: [{}] });

    await emitImportJobFailed(failedParams);

    const entry = ebMock.commandCalls(PutEventsCommand)[0].args[0].input.Entries![0];
    const detail = JSON.parse(entry.Detail!);

    expect(detail.error.code).toBe('PARSE_ERROR');
    expect(detail.error.message).toBe('Failed to parse CSV: unexpected end of file');
  });

  it('returns the PutEvents response from EventBridge', async () => {
    const mockResponse = {
      FailedEntryCount: 0,
      Entries: [{ EventId: 'evt-failed-001' }],
    };
    ebMock.on(PutEventsCommand).resolves(mockResponse);

    const result = await emitImportJobFailed(failedParams);

    expect(result.FailedEntryCount).toBe(0);
    expect(result.Entries![0].EventId).toBe('evt-failed-001');
  });

  it('handles different error codes (e.g. VALIDATION_ERROR)', async () => {
    ebMock.on(PutEventsCommand).resolves({ FailedEntryCount: 0, Entries: [{}] });

    const validationFailParams: EmitImportJobFailedParams = {
      ...failedParams,
      error: { code: 'VALIDATION_ERROR', message: 'All records failed validation' },
    };

    await emitImportJobFailed(validationFailParams);

    const entry = ebMock.commandCalls(PutEventsCommand)[0].args[0].input.Entries![0];
    const detail = JSON.parse(entry.Detail!);
    expect(detail.error.code).toBe('VALIDATION_ERROR');
  });

  it('handles S3 upload error codes', async () => {
    ebMock.on(PutEventsCommand).resolves({ FailedEntryCount: 0, Entries: [{}] });

    const s3FailParams: EmitImportJobFailedParams = {
      ...failedParams,
      error: { code: 'S3_UPLOAD_FAILED', message: 'S3 upload failed after 3 retries' },
    };

    await emitImportJobFailed(s3FailParams);

    const entry = ebMock.commandCalls(PutEventsCommand)[0].args[0].input.Entries![0];
    const detail = JSON.parse(entry.Detail!);
    expect(detail.error.code).toBe('S3_UPLOAD_FAILED');
  });
});

// ---------------------------------------------------------------------------
// Isolation: separate events do not bleed across calls
// ---------------------------------------------------------------------------

describe('event isolation', () => {
  it('emitting completed and failed events uses separate PutEventsCommand calls', async () => {
    ebMock.on(PutEventsCommand).resolves({ FailedEntryCount: 0, Entries: [{}] });

    await emitImportJobCompleted(completedParams);
    await emitImportJobFailed(failedParams);

    const calls = ebMock.commandCalls(PutEventsCommand);
    expect(calls).toHaveLength(2);

    const firstDetail = JSON.parse(calls[0].args[0].input.Entries![0].Detail!);
    const secondDetail = JSON.parse(calls[1].args[0].input.Entries![0].Detail!);

    expect(firstDetail.importJobId).toBe('job-001');
    expect(secondDetail.importJobId).toBe('job-002');
  });

  it('detail-type differs between completed and failed events', async () => {
    ebMock.on(PutEventsCommand).resolves({ FailedEntryCount: 0, Entries: [{}] });

    await emitImportJobCompleted(completedParams);
    await emitImportJobFailed(failedParams);

    const calls = ebMock.commandCalls(PutEventsCommand);
    expect(calls[0].args[0].input.Entries![0].DetailType).toBe('ImportJobCompleted');
    expect(calls[1].args[0].input.Entries![0].DetailType).toBe('ImportJobFailed');
  });
});
