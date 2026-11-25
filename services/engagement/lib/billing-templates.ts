/**
 * Payment-cycle and win-back emails (plain layout, signed "The MerchOS team").
 * MerchOS never charges automatically, so every email asks the seller to pay
 * from Billing; none of them claim a payment will be taken.
 *
 *   Account (always sent)   due7, due1, paused, final, closed, wb180, welcomeBack
 *   Marketing (opt-out)     wb44, wb60 (why did you leave), wb90 (comeback offer)
 */

import {
  bullets,
  button,
  escapeHtml,
  heading,
  htmlToText,
  link,
  para,
  plainEmail,
  small,
} from '../../shared/email/plain-email';
import { formatNumber, longDate, type RenderedEmail } from './templates';

const MARKETPLACES = 'Takealot, Makro, Amazon, Shopify and WooCommerce';

function render(subject: string, preheader: string, body: string, unsubscribeUrl?: string): RenderedEmail {
  const html = plainEmail({ preheader, body, ...(unsubscribeUrl ? { unsubscribeUrl } : {}) });
  return { subject, html, text: htmlToText(html) };
}

const hello = (firstName?: string) => para(firstName ? `Hello ${escapeHtml(firstName)}` : 'Hello');
const date = (iso: string) => escapeHtml(longDate(iso));
const products = (n: number) => (n === 1 ? '1 product' : `${formatNumber(n)} products`);
/** 44950 -> "R449.50", 179000 -> "R1,790". */
export const rand = (cents: number): string => {
  const c = cents % 100;
  return `R${formatNumber(Math.floor(cents / 100))}${c ? `.${String(c).padStart(2, '0')}` : ''}`;
};

export interface CycleInput {
  siteUrl: string;
  firstName?: string | undefined;
  planName: string;
  paidUntil: string;
  graceEndsAt: string;
  closesAt: string;
  dataKeptUntil: string;
  /** Products in the account. */
  productCount: number;
  /** Card on file, charged automatically each month. */
  autoRenew?: boolean | undefined;
}

const payUrl = (siteUrl: string) => `${siteUrl}/billing?renew=1`;

// ─── Before the end ─────────────────────────────────────────────────────────

export function dueInSevenDays(i: CycleInput): RenderedEmail {
  if (i.autoRenew) {
    const auto =
      hello(i.firstName) +
      para(`Your <b>${escapeHtml(i.planName)} plan</b> renews on <b>${date(i.paidUntil)}</b>. We will charge your card for your next month on that day, so there is nothing you need to do.`) +
      para('To change your plan, update your card or stop automatic billing, go to Billing.') +
      button('Manage billing', `${i.siteUrl}/billing`);
    return render(`Your MerchOS plan renews on ${longDate(i.paidUntil)}`, 'We will charge your card on that day. Nothing to do.', auto);
  }
  const body =
    hello(i.firstName) +
    para(`Your <b>${escapeHtml(i.planName)} plan</b> is paid until <b>${date(i.paidUntil)}</b>.`) +
    para(
      'To carry on without a break, pay for your next month from Billing. Paying early never costs you days: your new month starts when this one ends.',
    ) +
    button('Pay for my next month', payUrl(i.siteUrl)) +
    small('We never charge you automatically, so nothing is taken from your account unless you pay.');
  return render(`Your MerchOS plan ends on ${longDate(i.paidUntil)}`, 'Pay now to keep adding products without a break.', body);
}

export function dueTomorrow(i: CycleInput): RenderedEmail {
  const body =
    hello(i.firstName) +
    para(`A reminder that your <b>${escapeHtml(i.planName)} plan</b> ends on <b>${date(i.paidUntil)}</b>.`) +
    para(
      `If you need a little longer, everything keeps working until ${date(i.graceEndsAt)}. After that your plan is paused until you pay.`,
    ) +
    button('Pay for my next month', payUrl(i.siteUrl));
  return render('Reminder: your MerchOS plan ends tomorrow', 'Pay today to carry on without a break.', body);
}

// ─── After the end ──────────────────────────────────────────────────────────

export function planPaused(i: CycleInput): RenderedEmail {
  const why = i.autoRenew
    ? `we could not charge your card for your ${escapeHtml(i.planName)} plan, so it is now paused.`
    : `we have not received a payment for your ${escapeHtml(i.planName)} plan, so it is now paused.`;
  const body =
    heading('Your plan is paused') +
    para(`${i.firstName ? `Hi ${escapeHtml(i.firstName)}, ` : ''}${i.firstName ? why : why.charAt(0).toUpperCase() + why.slice(1)}`) +
    bullets([
      `Your ${products(i.productCount)} and their listings are safe`,
      'You can still sign in, edit your products and export them',
      'Adding new products and writing new listings is paused',
    ]) +
    para(
      i.autoRenew
        ? 'Update your card, or pay this month by EFT, and everything works again straight away.'
        : 'Pay now and everything works again straight away.',
    ) +
    button(i.autoRenew ? 'Update my card or pay by EFT' : 'Pay now', payUrl(i.siteUrl)) +
    small(
      `If we have not received a payment by ${date(i.closesAt)}, your account will close. Your products are kept, and you can come back at any time.`,
    );
  return render('Your MerchOS plan is paused', 'Your products are safe. Pay now to carry on.', body);
}

export function closingInSevenDays(i: CycleInput): RenderedEmail {
  const body =
    hello(i.firstName) +
    para(`Your plan has been paused since ${date(i.graceEndsAt)}. On <b>${date(i.closesAt)}</b> your account will close.`) +
    para(
      `After that you can only sign in to pay. Your ${products(i.productCount)} and their listings are kept until ${date(i.dataKeptUntil)}.`,
    ) +
    button('Pay now and keep my account open', payUrl(i.siteUrl));
  return render('Your MerchOS account closes in 7 days', 'Pay now to keep your account open.', body);
}

export function accountClosed(i: CycleInput): RenderedEmail {
  const body =
    heading('Your products are safe') +
    para(
      `${i.firstName ? `Hi ${escapeHtml(i.firstName)}, y` : 'Y'}our MerchOS account is now closed because we did not receive a payment. We have kept your ${products(i.productCount)} and their listings.`,
    ) +
    para('Reactivate in two minutes and carry on exactly where you left off.') +
    button('Reactivate my account', `${i.siteUrl}/dashboard`) +
    small(`Your products are kept until ${date(i.dataKeptUntil)}.`);
  return render(
    'Your MerchOS account is closed, but your products are safe',
    'Reactivate any time and carry on where you left off.',
    body,
  );
}

// ─── Win-back ───────────────────────────────────────────────────────────────

export function productsWaiting(i: CycleInput & { unsubscribeUrl: string }): RenderedEmail {
  const body =
    heading(`Your ${products(i.productCount)} are still waiting`) +
    para(
      `${i.firstName ? `Hi ${escapeHtml(i.firstName)}, y` : 'Y'}ou built ${products(i.productCount)} with MerchOS. They are all still here, with their listings, ready to export to ${MARKETPLACES}.`,
    ) +
    para('Come back and you can add new products and write listings again straight away.') +
    button('Reactivate my account', `${i.siteUrl}/dashboard`);
  return render(`Your ${products(i.productCount)} are still waiting`, 'Everything you built is still here.', body, i.unsubscribeUrl);
}

export const LEAVE_REASONS = [
  ['too_expensive', 'It is too expensive'],
  ['no_time', 'I do not have the time right now'],
  ['business_quiet', 'My business is quiet'],
  ['other_tool', 'I use something else'],
  ['other', 'Something else'],
] as const;
export type LeaveReason = (typeof LEAVE_REASONS)[number][0];

export function whyDidYouLeave(i: {
  firstName?: string | undefined;
  /** The feedback page for one reason (signed link). */
  reasonUrl: (reason: LeaveReason) => string;
  unsubscribeUrl: string;
}): RenderedEmail {
  const body =
    heading('Can we ask why you left?') +
    para(
      `${i.firstName ? `Hi ${escapeHtml(i.firstName)}, i` : 'I'}t takes one click, and it helps us make MerchOS better for sellers like you. Which is closest?`,
    ) +
    bullets(LEAVE_REASONS.map(([id, label]) => link(i.reasonUrl(id), label))) +
    para('Or simply reply to this email. We read every reply.');
  return render('Can we ask why you left?', 'One click. It helps us make MerchOS better.', body, i.unsubscribeUrl);
}

export function comebackOfferEmail(
  i: CycleInput & { percentOff: number; offerEndsAt: string; listPriceCents: number | null; unsubscribeUrl: string },
): RenderedEmail {
  const price =
    i.listPriceCents !== null
      ? ` ${escapeHtml(i.planName)} is ${rand(Math.round((i.listPriceCents * (100 - i.percentOff)) / 100))} instead of ${rand(i.listPriceCents)}.`
      : '';
  const body =
    heading(`Come back for ${i.percentOff}% off your first month`) +
    para(
      `${i.firstName ? `Hi ${escapeHtml(i.firstName)}, f` : 'F'}or the next 14 days your first month back is ${i.percentOff}% off.${price}`,
    ) +
    para(
      `Your ${products(i.productCount)} are still here. The discount is applied automatically when you pay, until ${date(i.offerEndsAt)}. No code needed.`,
    ) +
    button(`Come back for ${i.percentOff}% off`, `${i.siteUrl}/dashboard`);
  return render(
    `Come back for less: ${i.percentOff}% off your first month`,
    `Your first month back is ${i.percentOff}% off for the next 14 days.`,
    body,
    i.unsubscribeUrl,
  );
}

export function dataKeptReminder(i: CycleInput): RenderedEmail {
  const body =
    hello(i.firstName) +
    para(
      `Your MerchOS account has been closed since ${date(i.closesAt)}. We keep your ${products(i.productCount)} and their listings until <b>${date(i.dataKeptUntil)}</b>. After that they are deleted.`,
    ) +
    para('To keep them, reactivate your account before then.') +
    button('Reactivate my account', `${i.siteUrl}/dashboard`);
  return render(
    `Last reminder: your MerchOS products are kept until ${longDate(i.dataKeptUntil)}`,
    'Reactivate before then to keep your products.',
    body,
  );
}

// ─── Coming back ────────────────────────────────────────────────────────────

export function welcomeBack(i: {
  siteUrl: string;
  firstName?: string | undefined;
  planName: string;
  monthlyProducts: number | null;
  productCount: number;
  paidUntil: string;
}): RenderedEmail {
  const body =
    heading('Welcome back') +
    para(
      `${i.firstName ? `Thanks ${escapeHtml(i.firstName)}, y` : 'Thanks, y'}our <b>${escapeHtml(i.planName)} plan</b> is active again.`,
    ) +
    bullets([
      `Your ${products(i.productCount)} and their listings are all here`,
      i.monthlyProducts !== null
        ? `You can add ${formatNumber(i.monthlyProducts)} new products this month`
        : 'You can add new products again',
      `Paid until ${date(i.paidUntil)}`,
    ]) +
    button('Go to my dashboard', `${i.siteUrl}/dashboard`);
  return render('Welcome back to MerchOS', `Your ${i.planName} plan is active again.`, body);
}

// ─── Internal: why a seller left (support mailbox) ──────────────────────────

export function feedbackAlert(i: {
  adminUrl: string;
  reason: string;
  comment?: string | undefined;
  businessName?: string | undefined;
  email?: string | undefined;
}): RenderedEmail {
  const who = `${i.businessName ? escapeHtml(i.businessName) : 'A seller'}${i.email ? `, ${escapeHtml(i.email)}` : ''}`;
  const body =
    heading('A seller told us why they left') +
    para(`From ${who}.`) +
    para(`<b>${escapeHtml(i.reason)}</b>`) +
    para(i.comment ? `"${escapeHtml(i.comment)}"` : 'No comment left.') +
    button('Open Billing', `${i.adminUrl}/billing`);
  return render(`Why they left: ${i.reason}`, 'A seller answered the "why did you leave?" email.', body);
}
