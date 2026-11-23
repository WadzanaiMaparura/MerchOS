import { describe, expect, it } from 'vitest';
import {
  ordinal,
  referralInvite,
  reviewAlert,
  reviewRequest,
  subscriptionWelcome,
  tips,
  training,
  trialWelcome,
  type RenderedEmail,
} from '../lib/templates';

const site = 'https://merchos.co.za';
const unsub = 'https://merchos.co.za/unsubscribe?t=abc';

const all: Record<string, RenderedEmail> = {
  trial: trialWelcome({ siteUrl: site, firstName: 'Thandi', businessName: 'Thandi Home Goods', email: 'thandi@example.co.za', trialProducts: 15 }),
  subscribed: subscriptionWelcome({ siteUrl: site, firstName: 'Thandi', planName: 'Growth', monthlyProducts: 1000, existingProducts: 12, billingDay: 22 }),
  tips: tips({ siteUrl: site, firstName: 'Thandi' }),
  training: training({ siteUrl: site, firstName: 'Thandi' }),
  review: reviewRequest({ firstName: 'Thandi', listings: 48, starUrl: (n) => `${site}/review?t=x&r=${n}`, unsubscribeUrl: unsub }),
  referral: referralInvite({ siteUrl: site, firstName: 'Thandi', linkLabel: 'merchos.co.za/r/THANDI7K', unsubscribeUrl: unsub }),
};

describe('lifecycle email templates', () => {
  it.each(Object.entries(all))('%s follows the house rules', (_name, email) => {
    for (const part of [email.subject, email.html, email.text]) {
      expect(part).not.toMatch(/\bAI\b/);
      expect(part).not.toMatch(/\u2014/); // no em dashes
      expect(part).not.toMatch(/Imani/);
    }
    expect(email.html).toContain('https://merchos.co.za/email/merchos-m.png');
    expect(email.html).toContain('Kind regards,<br>The MerchOS team');
    expect(email.text).toContain('The MerchOS team');
    expect(email.text).not.toMatch(/<[a-z]/i);
  });

  it('only marketing emails carry an unsubscribe link', () => {
    expect(all['review']!.html).toContain('Unsubscribe');
    expect(all['referral']!.html).toContain('Unsubscribe');
    for (const key of ['trial', 'subscribed', 'tips', 'training']) {
      expect(all[key]!.html).not.toContain('Unsubscribe');
    }
  });

  it('uses the approved subjects', () => {
    expect(all['trial']!.subject).toBe('Welcome to MerchOS, your free trial has started');
    expect(all['subscribed']!.subject).toBe('Thank you for subscribing to MerchOS');
    expect(all['review']!.subject).toBe('How has your first month been?');
    expect(all['referral']!.subject).toBe('Refer a seller, get a month free');
  });

  it('trial welcome lists the account and the first-listing button', () => {
    const { html } = all['trial']!;
    expect(html).toContain('Hello Thandi');
    expect(html).toContain('Create your first 15 products free');
    expect(html).toContain('Your account: Thandi Home Goods, signed in as thandi@example.co.za.');
    expect(html).toContain('Start my first listing');
  });

  it('subscription welcome shows the plan, kept products and billing day', () => {
    const { html } = all['subscribed']!;
    expect(html).toContain('<b>Growth plan</b> is now active');
    expect(html).toContain('1,000 new products a month');
    expect(html).toContain('Your 12 trial products and listings are all still in your account');
    expect(html).toContain('resets on the 22nd of each month');
    expect(html).toContain('Go to my dashboard');
  });

  it('subscription welcome without trial products or a fixed allowance', () => {
    const { html } = subscriptionWelcome({ siteUrl: site, planName: 'Enterprise', monthlyProducts: null, existingProducts: 0, billingDay: 31 });
    expect(html).toContain('Hello');
    expect(html).not.toContain('trial products');
    expect(html).toContain('New products as agreed for your plan');
    expect(html).toContain('the 31st of each month (or the last day of shorter months)');
  });

  it('training asks them to reply for a call, without naming staff', () => {
    expect(all['training']!.html).toContain('Reply to this email and we will call you');
  });

  it('review email has five star links and the listing count', () => {
    const { html } = all['review']!;
    for (let n = 1; n <= 5; n++) expect(html).toContain(`r=${n}`);
    expect(html).toContain('<b>48 listings</b>');
    expect(html).toContain('Tap a star to rate MerchOS');
  });

  it('referral email shows the personal link and the terms', () => {
    const { html } = all['referral']!;
    expect(html).toContain('merchos.co.za/r/THANDI7K');
    expect(html).toContain('Copy my link');
    expect(html).toContain('stays subscribed for 14 days and is actively using MerchOS (at least 10 products added within 90 days of subscribing). There is no limit.');
  });

  it('escapes seller-supplied values', () => {
    const email = trialWelcome({ siteUrl: site, firstName: '<b>x</b>', businessName: 'A & B <script>', email: 'a@b.co', trialProducts: 15 });
    expect(email.html).not.toContain('<script>');
    expect(email.html).toContain('A &amp; B &lt;script&gt;');
    const alert = reviewAlert({ adminUrl: 'https://admin.merchos.co.za', rating: 2, text: '<img src=x>', displayName: 'T', consentToPublish: false });
    expect(alert.html).not.toContain('<img src=x>');
    expect(alert.subject).toMatch(/^Low rating: 2 stars/);
  });

  it('falls back to a plain greeting without a name', () => {
    expect(tips({ siteUrl: site }).html).toContain('Hi, these are the features');
  });

  it('ordinal', () => {
    expect([1, 2, 3, 4, 11, 12, 13, 21, 22, 23, 31].map(ordinal)).toEqual([
      '1st', '2nd', '3rd', '4th', '11th', '12th', '13th', '21st', '22nd', '23rd', '31st',
    ]);
  });
});
