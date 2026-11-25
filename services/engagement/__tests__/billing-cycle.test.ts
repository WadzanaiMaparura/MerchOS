import type { APIGatewayProxyEventV2 } from 'aws-lambda';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fakeStore, mem } from './fake-store';

vi.mock('../lib/store', () => fakeStore);

const accounts = vi.hoisted(() => ({
  users: new Map<string, { email: string; enabled: boolean }>(),
  products: new Map<string, number>(),
  paid: new Map<string, { status: string; subscribedUntil?: string; autoRenew?: boolean }>(),
}));
vi.mock('../lib/accounts', async () => {
  const actual = await vi.importActual<typeof import('../lib/accounts')>('../lib/accounts');
  const store = await import('./fake-store');
  return {
    firstNameOf: actual.firstNameOf,
    shortName: actual.shortName,
    getUser: async (id: string) => accounts.users.get(id) ?? null,
    getOwnerDetails: async () => ({ fullName: 'Thandi Khumalo', businessName: 'Thandi Home Goods' }),
    countProducts: async (t: string) => accounts.products.get(t) ?? 0,
    isSubscribedNow: async () => false,
    getPaidStatus: async (t: string) => accounts.paid.get(t) ?? null,
    ensureProfile: async (tenantId: string) => store.mem.profiles.get(tenantId) ?? null,
  };
});

const sent = vi.hoisted(() => [] as Array<{ to: string; subject: string; html: string; text: string; listUnsubscribeUrl?: string }>);
vi.mock('../lib/mailer', () => ({
  sendEmail: vi.fn(async (e: { to: string; subject: string; html: string; text: string; listUnsubscribeUrl?: string }) => {
    sent.push(e);
    return `msg-${sent.length}`;
  }),
}));

const created = vi.hoisted(() => [] as Array<{ Name: string; ScheduleExpression: string; Input: string }>);
vi.mock('@aws-sdk/client-scheduler', () => ({
  SchedulerClient: class {
    async send(cmd: { input: { Name: string; ScheduleExpression: string; Target: { Input: string } } }) {
      created.push({ Name: cmd.input.Name, ScheduleExpression: cmd.input.ScheduleExpression, Input: cmd.input.Target.Input });
      return {};
    }
  },
  CreateScheduleCommand: class {
    constructor(public input: unknown) {}
  },
  ConflictException: class extends Error {},
}));

import { BILLING_STEPS, billingDueDate } from '../lib/billing-cycle';
import {
  accountClosed,
  closingInSevenDays,
  comebackOfferEmail,
  dataKeptReminder,
  dueInSevenDays,
  dueTomorrow,
  planPaused,
  productsWaiting,
  rand,
  welcomeBack,
  whyDidYouLeave,
} from '../lib/billing-templates';
import { _setTokenSecret } from '../lib/config';
import { isMarketingKey } from '../lib/lifecycle';
import { scheduleBillingSteps, scheduleName } from '../lib/schedule';
import { issueToken } from '../lib/tokens';
import { isComeback, onSubscriptionActivated } from '../handlers/on-event';
import { handler as publicApi } from '../handlers/public-api';
import { runStep } from '../handlers/scheduled';

const TENANT = '7e22ed36-cf82-43ba-b194-8bd4cfab5166';
const OWNER = 'a21594a4-3081-709b-a851-17abe27d90c5';
const UNTIL = '2026-12-22T10:00:00.000Z';
const site = 'https://merchos.co.za';

beforeEach(() => {
  mem.reset();
  sent.length = 0;
  created.length = 0;
  accounts.users.clear();
  accounts.products.clear();
  accounts.paid.clear();
  accounts.users.set(OWNER, { email: 'thandi@example.co.za', enabled: true });
  accounts.products.set(TENANT, 412);
  accounts.paid.set(TENANT, { status: 'subscribed', subscribedUntil: UNTIL });
  mem.profiles.set(TENANT, {
    tenantId: TENANT,
    userId: OWNER,
    email: 'thandi@example.co.za',
    firstName: 'Thandi',
    businessName: 'Thandi Home Goods',
    createdAt: '2026-11-01T00:00:00.000Z',
  });
  process.env['SITE_URL'] = site;
  process.env['ENGAGEMENT_API_URL'] = 'https://api.example.com';
  process.env['SCHEDULE_GROUP'] = 'grp';
  process.env['SCHEDULED_FUNCTION_ARN'] = 'arn:fn';
  process.env['SCHEDULER_ROLE_ARN'] = 'arn:role';
  process.env['SELLER_ORIGINS'] = site;
  process.env['SUPPORT_EMAIL'] = 'info@merchos.co.za';
  process.env['BILLING_LIFECYCLE'] = 'true';
  _setTokenSecret('test-secret');
});

describe('when each email goes out', () => {
  it('9am SA time, reminders on or before the moment, notices on or after it', () => {
    const due = Object.fromEntries(BILLING_STEPS.map((s) => [s, billingDueDate(s, UNTIL).toISOString()]));
    expect(due).toEqual({
      due7: '2026-12-15T07:00:00.000Z',
      due1: '2026-12-21T07:00:00.000Z',
      paused: '2026-12-26T07:00:00.000Z', // grace ends 25 Dec 10:00, so not at 07:00 that day
      final: '2027-01-22T07:00:00.000Z',
      closed: '2027-01-29T07:00:00.000Z',
      wb44: '2027-02-05T07:00:00.000Z',
      wb60: '2027-02-21T07:00:00.000Z',
      wb90: '2027-03-23T07:00:00.000Z',
      wb180: '2027-06-21T07:00:00.000Z',
    });
  });

  it('books one schedule per step per paid period, skipping steps already past', async () => {
    const booked = await scheduleBillingSteps(TENANT, UNTIL, 'growth', new Date('2026-12-18T00:00:00.000Z'));
    expect(booked).toEqual(['due1', 'paused', 'final', 'closed', 'wb44', 'wb60', 'wb90', 'wb180']);
    expect(created[0]!.Name).toBe(`eng-due1-${TENANT}-20261222`);
    expect(created.every((c) => c.Name.length <= 64)).toBe(true);
    expect(JSON.parse(created[0]!.Input)).toEqual({ step: 'due1', tenantId: TENANT, paidUntil: UNTIL, planId: 'growth' });
    expect(scheduleName({ step: 'tips', tenantId: TENANT })).toBe(`eng-tips-${TENANT}`);
  });

  it('a payment books the cycle; returning after a pause also says welcome back (once)', async () => {
    const event = {
      tenantId: TENANT,
      planId: 'growth',
      planName: 'Growth',
      monthlyProducts: 1000,
      mPaymentId: 'p2',
      periodStart: new Date().toISOString(),
      periodEnd: new Date(Date.now() + 30 * 86_400_000).toISOString(),
      previousPeriodEnd: new Date(Date.now() - 50 * 86_400_000).toISOString(),
    };
    mem.profiles.get(TENANT)!.subscribedAt = '2026-01-01T00:00:00.000Z';
    mem.sent.set(`${TENANT}|subscription-welcome`, {});
    await onSubscriptionActivated(event);
    await onSubscriptionActivated(event); // retry
    expect(sent.map((s) => s.subject)).toEqual(['Welcome back to MerchOS']);
    expect(sent[0]!.html).toContain('412 products');
    expect(created.some((c) => c.Name.startsWith(`eng-due7-${TENANT}-`))).toBe(true);
    expect(isComeback(undefined, new Date())).toBe(false);
    expect(isComeback(UNTIL, new Date('2026-12-24T00:00:00.000Z'))).toBe(false); // still in grace
    expect(isComeback(UNTIL, new Date('2026-12-26T00:00:00.000Z'))).toBe(true);
  });
});

describe('sending a step', () => {
  const step = (s: string, paidUntil = UNTIL) => runStep({ step: s, tenantId: TENANT, paidUntil, planId: 'growth' });

  it('sends each account notice once per paid period', async () => {
    for (const s of ['due7', 'due1', 'paused', 'final', 'closed', 'wb180']) {
      expect(await step(s)).toBe('sent');
      expect(await step(s)).toBe('duplicate');
    }
    expect(sent.map((e) => e.subject)).toEqual([
      'Your MerchOS plan ends on 22 December 2026',
      'Reminder: your MerchOS plan ends tomorrow',
      'Your MerchOS plan is paused',
      'Your MerchOS account closes in 7 days',
      'Your MerchOS account is closed, but your products are safe',
      'Last reminder: your MerchOS products are kept until 28 January 2028',
    ]);
    expect(sent.every((e) => !e.listUnsubscribeUrl && !e.html.includes('Unsubscribe'))).toBe(true);
    expect(sent[2]!.html).toContain('Your 412 products and their listings are safe');
    expect(sent[2]!.html).toContain('https://merchos.co.za/billing?renew=1');
  });

  it('paying for a later period cancels the rest quietly', async () => {
    accounts.paid.set(TENANT, { status: 'subscribed', subscribedUntil: '2027-01-22T10:00:00.000Z' });
    expect(await step('paused')).toBe('renewed');
    expect(sent).toHaveLength(0);
  });

  it('skips free unlimited accounts, disabled accounts, and everything while switched off', async () => {
    accounts.paid.set(TENANT, { status: 'exempt', subscribedUntil: UNTIL });
    expect(await step('paused')).toBe('skipped');
    accounts.paid.set(TENANT, { status: 'subscribed', subscribedUntil: UNTIL });
    accounts.users.set(OWNER, { email: 'thandi@example.co.za', enabled: false });
    expect(await step('paused')).toBe('skipped');
    process.env['BILLING_LIFECYCLE'] = 'false';
    expect(await step('due7')).toBe('switched-off');
    expect(sent).toHaveLength(0);
  });

  it('win-back emails respect the unsubscribe and carry one', async () => {
    expect(await step('wb44')).toBe('sent');
    expect(sent[0]!.listUnsubscribeUrl).toMatch(/^https:\/\/api\.example\.com\/unsubscribe\?t=un\./);
    expect(sent[0]!.html).toContain('Unsubscribe');
    mem.profiles.get(TENANT)!.marketingOptOut = true;
    expect(await step('wb60')).toBe('opted-out');
    expect(await step('final')).toBe('sent'); // account notices still go
    expect(isMarketingKey('wb90#x')).toBe(true);
    expect(isMarketingKey('paused#x')).toBe(false);
  });

  it('the "why did you leave" email links each answer to a signed feedback page', async () => {
    expect(await step('wb60')).toBe('sent');
    expect(sent[0]!.html).toMatch(/https:\/\/merchos\.co\.za\/feedback\?t=fb\.[^&"]+&amp;r=too_expensive/);
  });

  it('the comeback offer goes only inside its window', async () => {
    const lateUntil = new Date(Date.now() - 91 * 86_400_000).toISOString();
    accounts.paid.set(TENANT, { status: 'subscribed', subscribedUntil: lateUntil });
    expect(await step('wb90', lateUntil)).toBe('sent');
    expect(sent[0]!.subject).toBe('Come back for less: 50% off your first month');
    expect(sent[0]!.html).toContain('Growth is R449.50 instead of R899');
    const tooLate = new Date(Date.now() - 120 * 86_400_000).toISOString();
    accounts.paid.set(TENANT, { status: 'subscribed', subscribedUntil: tooLate });
    expect(await step('wb90', tooLate)).toBe('skipped');
  });
});

describe('the emails', () => {
  const base = {
    siteUrl: site,
    firstName: 'Thandi',
    planName: 'Growth',
    paidUntil: UNTIL,
    graceEndsAt: '2026-12-25T10:00:00.000Z',
    closesAt: '2027-01-28T10:00:00.000Z',
    dataKeptUntil: '2028-01-28T10:00:00.000Z',
    productCount: 412,
  };
  const all = {
    due7: dueInSevenDays(base),
    due1: dueTomorrow(base),
    paused: planPaused(base),
    final: closingInSevenDays(base),
    closed: accountClosed(base),
    wb44: productsWaiting({ ...base, unsubscribeUrl: 'u' }),
    wb60: whyDidYouLeave({ firstName: 'Thandi', reasonUrl: (r) => `${site}/feedback?r=${r}`, unsubscribeUrl: 'u' }),
    wb90: comebackOfferEmail({ ...base, percentOff: 50, offerEndsAt: '2027-04-05T10:00:00.000Z', listPriceCents: 179000, unsubscribeUrl: 'u' }),
    wb180: dataKeptReminder(base),
    back: welcomeBack({ siteUrl: site, firstName: 'Thandi', planName: 'Growth', monthlyProducts: 1000, productCount: 412, paidUntil: UNTIL }),
  };

  it.each(Object.entries(all))('%s follows the house rules', (_name, email) => {
    for (const part of [email.subject, email.html, email.text]) {
      expect(part).not.toMatch(/\bAI\b/);
      expect(part).not.toMatch(/\u2014/);
      expect(part).not.toMatch(/we will charge|automatically charge|debit/i);
    }
    expect(email.html).toContain('The MerchOS team');
    expect(email.text).not.toMatch(/<[a-z]/i);
  });

  it('money is shown the South African way', () => {
    expect(rand(44950)).toBe('R449.50');
    expect(rand(179000)).toBe('R1,790');
    expect(all.wb90.html).toContain('R895 instead of R1,790');
  });
});

describe('POST /feedback', () => {
  const post = async (body: unknown, origin = site) =>
    (await publicApi({
      routeKey: 'POST /feedback',
      headers: { origin },
      body: JSON.stringify(body),
      isBase64Encoded: false,
      requestContext: { http: { sourceIp: '1.2.3.4' } },
    } as unknown as APIGatewayProxyEventV2)) as { statusCode: number; body: string };

  it('saves one answer per seller and tells the support mailbox', async () => {
    const token = issueToken('feedback', TENANT, 'test-secret');
    expect((await post({ token, reason: 'too_expensive', comment: 'Need a smaller plan' })).statusCode).toBe(201);
    expect(mem.feedback.get(TENANT)).toMatchObject({ reason: 'too_expensive', comment: 'Need a smaller plan' });
    expect(sent.at(-1)!.to).toBe('info@merchos.co.za');
    expect(sent.at(-1)!.subject).toBe('Why they left: It is too expensive');
  });

  it('refuses other links, unknown answers and other sites', async () => {
    const review = issueToken('review', TENANT, 'test-secret');
    expect((await post({ token: review, reason: 'other' })).statusCode).toBe(400);
    const token = issueToken('feedback', TENANT, 'test-secret');
    expect((await post({ token, reason: 'hate_it' })).statusCode).toBe(400);
    expect((await post({ token, reason: 'other' }, 'https://evil.example')).statusCode).toBe(403);
    expect(mem.feedback.size).toBe(0);
  });
});

describe('card on file (automatic monthly charges)', () => {
  const step = (s: string) => runStep({ step: s, tenantId: TENANT, paidUntil: UNTIL, planId: 'growth' });

  beforeEach(() => {
    accounts.paid.set(TENANT, { status: 'subscribed', subscribedUntil: UNTIL, autoRenew: true });
  });

  it('the 7-day email says the card will be charged, and there is no 1-day "please pay"', async () => {
    expect(await step('due7')).toBe('sent');
    expect(sent[0]!.subject).toBe('Your MerchOS plan renews on 22 December 2026');
    expect(sent[0]!.html).toContain('We will charge your card for your next month on that day');
    expect(sent[0]!.html).not.toContain('Pay for my next month');
    expect(await step('due1')).toBe('skipped');
  });

  it('a declined card: paused email offers to update the card or pay by EFT', async () => {
    expect(await step('paused')).toBe('sent');
    expect(sent[0]!.html).toContain('we could not charge your card for your Growth plan');
    expect(sent[0]!.html).toContain('Update my card or pay by EFT');
  });

  it('the card wording follows the account, not the switch alone', () => {
    const base = {
      siteUrl: site, planName: 'Growth', paidUntil: UNTIL, graceEndsAt: UNTIL, closesAt: UNTIL, dataKeptUntil: UNTIL, productCount: 1,
    };
    expect(dueInSevenDays({ ...base, autoRenew: false }).html).toContain('Pay for my next month');
    expect(planPaused({ ...base }).html).toContain('We have not received a payment');
  });
});
