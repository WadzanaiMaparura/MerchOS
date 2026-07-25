import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { mockClient } from 'aws-sdk-client-mock';
import {
  EventBridgeClient,
  PutEventsCommand,
} from '@aws-sdk/client-eventbridge';
import {
  emitAuthEvent,
  getEventBridgeClient,
  resetForTesting,
} from '../../utils/event-emitter';

const ebMock = mockClient(EventBridgeClient);

describe('event-emitter', () => {
  beforeEach(() => {
    ebMock.reset();
    resetForTesting();
    process.env['EVENT_BUS_NAME'] = 'merch-os-events-dev';
    process.env['AWS_REGION'] = 'af-south-1';
  });

  afterEach(() => {
    delete process.env['EVENT_BUS_NAME'];
    delete process.env['AWS_REGION'];
  });

  describe('getEventBridgeClient', () => {
    it('returns a singleton client instance', () => {
      const client1 = getEventBridgeClient();
      const client2 = getEventBridgeClient();
      expect(client1).toBe(client2);
    });

    it('returns a new instance after resetForTesting', () => {
      const client1 = getEventBridgeClient();
      resetForTesting();
      const client2 = getEventBridgeClient();
      expect(client1).not.toBe(client2);
    });
  });

  describe('emitAuthEvent', () => {
    it('throws when EVENT_BUS_NAME is not set', async () => {
      delete process.env['EVENT_BUS_NAME'];

      await expect(
        emitAuthEvent({
          detailType: 'auth.user.registered',
          detail: { userId: 'user-123' },
        })
      ).rejects.toThrow('EVENT_BUS_NAME environment variable is not set');
    });

    it('sends a PutEventsCommand with correct parameters', async () => {
      ebMock.on(PutEventsCommand).resolves({
        FailedEntryCount: 0,
        Entries: [{ EventId: 'evt-1' }],
      });

      const detail = { userId: 'user-123', tenantId: 'tenant-abc' };

      await emitAuthEvent({
        detailType: 'auth.user.registered',
        detail,
      });

      const calls = ebMock.commandCalls(PutEventsCommand);
      expect(calls).toHaveLength(1);

      const input = calls[0].args[0].input;
      expect(input.Entries).toHaveLength(1);
      expect(input.Entries![0].Source).toBe('merch-os.auth');
      expect(input.Entries![0].DetailType).toBe('auth.user.registered');
      expect(input.Entries![0].Detail).toBe(JSON.stringify(detail));
      expect(input.Entries![0].EventBusName).toBe('merch-os-events-dev');
      expect(input.Entries![0].Time).toBeInstanceOf(Date);
    });

    it('returns the PutEvents response', async () => {
      const mockResponse = {
        FailedEntryCount: 0,
        Entries: [{ EventId: 'evt-abc-123' }],
      };
      ebMock.on(PutEventsCommand).resolves(mockResponse);

      const result = await emitAuthEvent({
        detailType: 'auth.session.created',
        detail: { userId: 'user-456', sessionId: 'sess-789' },
      });

      expect(result.FailedEntryCount).toBe(0);
      expect(result.Entries).toHaveLength(1);
      expect(result.Entries![0].EventId).toBe('evt-abc-123');
    });

    it('supports all auth event detail types', async () => {
      ebMock.on(PutEventsCommand).resolves({ FailedEntryCount: 0, Entries: [{}] });

      const detailTypes = [
        'auth.user.registered',
        'auth.user.invited',
        'auth.user.verified',
        'auth.user.disabled',
        'auth.user.deleted',
        'auth.user.role-changed',
        'auth.session.created',
        'auth.session.revoked',
        'auth.password.reset',
        'auth.security.rate-limit',
      ] as const;

      for (const detailType of detailTypes) {
        await emitAuthEvent({ detailType, detail: { test: true } });
      }

      const calls = ebMock.commandCalls(PutEventsCommand);
      expect(calls).toHaveLength(detailTypes.length);
    });
  });
});
