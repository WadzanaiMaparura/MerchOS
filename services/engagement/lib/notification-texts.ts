/**
 * What each seller notification says. Plain words, no internal codes, no ids.
 * Each builder returns a NewNotification with a stable key, so a repeated
 * event never creates a second entry.
 */

import type { NewNotification } from './notifications';
import { longDate } from './templates';

const plural = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;

export interface ImportResults {
  created: number;
  updated: number;
  duplicates: number;
  validationFailed: number;
}

export function importCompleted(importJobId: string, r: ImportResults, at: string): NewNotification {
  const parts = [`${plural(r.created, 'product', 'products')} added`, `${r.updated} updated`];
  if (r.duplicates > 0) parts.push(`${plural(r.duplicates, 'duplicate', 'duplicates')} skipped`);
  let message = `${parts.join(', ')}.`;
  if (r.validationFailed > 0) message += ` ${plural(r.validationFailed, 'row needs', 'rows need')} fixing.`;
  return {
    key: `import-done:${importJobId}`,
    kind: 'import.completed',
    title: 'Import finished',
    message,
    link: `/imports/${encodeURIComponent(importJobId)}`,
    at,
  };
}

export function importFailed(importJobId: string, timedOut: boolean, at: string): NewNotification {
  return {
    key: `import-failed:${importJobId}`,
    kind: 'import.failed',
    title: 'Import failed',
    message: timedOut
      ? 'Your import took too long and was stopped. Open it to try again.'
      : 'Your import could not be finished. Open it to see what went wrong.',
    link: `/imports/${encodeURIComponent(importJobId)}`,
    at,
  };
}

const onProduct = (title: string | null) => (title ? `on "${title}"` : 'on one of your products');

export function imageRejected(imageJobId: string, productId: string, productTitle: string | null, at: string): NewNotification {
  return {
    key: `image-rejected:${imageJobId}`,
    kind: 'image.rejected',
    title: 'A photo was not accepted',
    message: `A photo ${onProduct(productTitle)} broke the photo rules. Open the product to replace it.`,
    link: `/products/${encodeURIComponent(productId)}`,
    at,
  };
}

export function imageFailed(imageJobId: string, productId: string, productTitle: string | null, at: string): NewNotification {
  return {
    key: `image-failed:${imageJobId}`,
    kind: 'image.failed',
    title: 'A photo could not be processed',
    message: `A photo ${onProduct(productTitle)} could not be processed. Please upload it again.`,
    link: `/products/${encodeURIComponent(productId)}`,
    at,
  };
}

export function paymentReceived(mPaymentId: string, planName: string, paidUntil: string, at: string): NewNotification {
  return {
    key: `payment:${mPaymentId}`,
    kind: 'payment.received',
    title: 'Payment received',
    message: `${planName} plan. You are paid up until ${longDate(paidUntil)}.`,
    link: '/billing',
    at,
  };
}

export function referralEarned(referredTenantId: string, at: string): NewNotification {
  return {
    key: `referral-earned:${referredTenantId}`,
    kind: 'referral.earned',
    title: 'You earned a free month',
    message: 'A seller you referred has subscribed. Your next monthly payment will be skipped.',
    link: '/referrals',
    at,
  };
}

export function referralApplied(referredTenantId: string, paidUntil: string, at: string): NewNotification {
  return {
    key: `referral-applied:${referredTenantId}`,
    kind: 'referral.applied',
    title: 'Free month added',
    message: `Thanks for referring a seller. You are paid up until ${longDate(paidUntil)}.`,
    link: '/referrals',
    at,
  };
}

export function paymentDue(paidUntil: string, autoRenew: boolean, at: string): NewNotification {
  return {
    key: `billing-due:${paidUntil}`,
    kind: 'billing.due',
    title: autoRenew ? 'Your card will be charged in 7 days' : 'Payment due in 7 days',
    message: autoRenew
      ? `Your plan renews on ${longDate(paidUntil)}. Nothing to do if your card is up to date.`
      : `Your plan is paid up until ${longDate(paidUntil)}. Pay before then to keep adding products.`,
    link: '/billing',
    at,
  };
}

export function planPausedNote(paidUntil: string, closesAt: string, at: string): NewNotification {
  return {
    key: `billing-paused:${paidUntil}`,
    kind: 'billing.paused',
    title: 'Your plan is paused',
    message: `Pay to start adding products again. Your products are kept until ${longDate(closesAt)}.`,
    link: '/billing',
    at,
  };
}

export function closingSoon(paidUntil: string, closesAt: string, at: string): NewNotification {
  return {
    key: `billing-closing:${paidUntil}`,
    kind: 'billing.closing',
    title: 'Your account closes in 7 days',
    message: `Pay before ${longDate(closesAt)} to keep your account and products.`,
    link: '/billing',
    at,
  };
}

export function trialUsage(used: number, limit: number, at: string): NewNotification {
  const left = Math.max(0, limit - used);
  if (left === 0) {
    return {
      key: 'trial-used',
      kind: 'trial.used',
      title: 'Free trial used up',
      message: `You have used all ${limit} free products. Pick a plan to keep adding.`,
      link: '/billing',
      at,
    };
  }
  return {
    key: 'trial-almost',
    kind: 'trial.almost',
    title: `Free trial: ${used} of ${limit} products used`,
    message: `${plural(left, 'free product', 'free products')} left. Pick a plan to keep adding.`,
    link: '/billing',
    at,
  };
}
