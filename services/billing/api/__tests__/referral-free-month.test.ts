import { beforeEach, describe, expect, it, vi } from 'vitest';

const apply = vi.hoisted(() => vi.fn());
vi.mock('../../services/free-month', () => ({ applyReferralFreeMonth: apply }));

import { handler } from '../handlers/referral-free-month';
import { _setEventBridgeClient } from '../../services/events';

const REFERRER = '11111111-1111-4111-8111-111111111111';
const REFERRED = '22222222-2222-4222-8222-222222222222';
const sent: Array<Record<string, unknown>> = [];

const event = (detail: unknown, type = 'engagement.referral.reward-earned') =>
  ({ 'detail-type': type, source: 'merch-os.engagement', detail }) as never;

beforeEach(() => {
  process.env['EVENT_BUS_NAME'] = 'merch-os-events-test';
  sent.length = 0;
  apply.mockReset();
  _setEventBridgeClient({
    send: async (cmd: { input: { Entries: Array<Record<string, unknown>> } }) => {
      sent.push(...cmd.input.Entries);
      return { FailedEntryCount: 0 };
    },
  } as never);
});

describe('referral free month handler', () => {
  it('applied: tells the platform with billing.subscription.extended', async () => {
    apply.mockResolvedValue({ outcome: 'applied', planId: 'starter', fromEnd: '2026-12-10T08:00:00.000Z', toEnd: '2027-01-10T08:00:00.000Z' });
    expect(await handler(event({ referrerTenantId: REFERRER, referredTenantId: REFERRED }))).toEqual({ result: 'applied' });
    expect(sent).toHaveLength(1);
    expect(sent[0]).toMatchObject({ Source: 'merch-os.billing', DetailType: 'billing.subscription.extended', EventBusName: 'merch-os-events-test' });
    expect(JSON.parse(sent[0]!['Detail'] as string)).toEqual({
      tenantId: REFERRER,
      planId: 'starter',
      reason: 'referral-free-month',
      referredTenantId: REFERRED,
      periodEnd: '2027-01-10T08:00:00.000Z',
      previousPeriodEnd: '2026-12-10T08:00:00.000Z',
    });
  });

  it('already applied: tells the platform again (finishes an interrupted attempt)', async () => {
    apply.mockResolvedValue({ outcome: 'already', planId: 'starter', fromEnd: '2026-12-10T08:00:00.000Z', toEnd: '2027-01-10T08:00:00.000Z' });
    await handler(event({ referrerTenantId: REFERRER, referredTenantId: REFERRED }));
    expect(sent).toHaveLength(1);
  });

  it.each(['not-paying', 'switched-off'])('%s: nothing is sent', async (outcome) => {
    apply.mockResolvedValue({ outcome });
    expect(await handler(event({ referrerTenantId: REFERRER, referredTenantId: REFERRED }))).toEqual({ result: outcome });
    expect(sent).toHaveLength(0);
  });

  it('ignores other events and bad ids', async () => {
    expect(await handler(event({ referrerTenantId: 'x', referredTenantId: REFERRED }))).toEqual({ result: 'ignored' });
    expect(await handler(event({ referrerTenantId: REFERRER, referredTenantId: REFERRED }, 'something.else'))).toEqual({ result: 'ignored' });
    expect(apply).not.toHaveBeenCalled();
  });

  it('errors propagate so EventBridge retries', async () => {
    apply.mockRejectedValue(new Error('PayFast subscriptions update failed (500)'));
    await expect(handler(event({ referrerTenantId: REFERRER, referredTenantId: REFERRED }))).rejects.toThrow('500');
    expect(sent).toHaveLength(0);
  });
});
