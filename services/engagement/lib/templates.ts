/**
 * The lifecycle emails, exactly as approved (plain layout, no names of staff,
 * signed "The MerchOS team"). Every value that comes from a seller is escaped.
 *
 *   Trial track       trialWelcome (sign-up), tips (day 2), training (day 5)
 *   Subscriber track  subscriptionWelcome (first payment), reviewRequest (day 30), referralInvite (day 35)
 *   Internal          reviewAlert (to the support mailbox)
 */

import {
  bullets,
  button,
  cards,
  copyBox,
  escapeHtml,
  heading,
  htmlToText,
  numbered,
  para,
  plainEmail,
  small,
  starRow,
  steps,
} from '../../shared/email/plain-email';

export interface RenderedEmail {
  subject: string;
  html: string;
  text: string;
}

const MARKETPLACES = 'Takealot, Makro, Amazon, Shopify and WooCommerce';

function render(subject: string, preheader: string, body: string, unsubscribeUrl?: string): RenderedEmail {
  const html = plainEmail({ preheader, body, ...(unsubscribeUrl ? { unsubscribeUrl } : {}) });
  return { subject, html, text: htmlToText(html) };
}

/** "Hello Thandi" / "Hello" */
const hello = (firstName?: string) => para(firstName ? `Hello ${escapeHtml(firstName)}` : 'Hello');
/** "Hi Thandi, " / "Hi, " at the start of a sentence. */
const hi = (firstName?: string) => (firstName ? `Hi ${escapeHtml(firstName)}, ` : 'Hi, ');

export const formatNumber = (n: number): string => n.toLocaleString('en-ZA').replace(/\u00a0/g, ',').replace(/\s/g, ',');

/** 1 -> "1st", 22 -> "22nd". */
export function ordinal(day: number): string {
  const rem100 = day % 100;
  if (rem100 >= 11 && rem100 <= 13) return `${day}th`;
  return `${day}${({ 1: 'st', 2: 'nd', 3: 'rd' } as Record<number, string>)[day % 10] ?? 'th'}`;
}

// ─── A. Trial welcome (sign-up) ─────────────────────────────────────────────

export interface TrialWelcomeInput {
  siteUrl: string;
  firstName?: string | undefined;
  businessName?: string | undefined;
  email: string;
  trialProducts: number;
}

export function trialWelcome(i: TrialWelcomeInput): RenderedEmail {
  const account = i.businessName
    ? `Your account: ${escapeHtml(i.businessName)}, signed in as ${escapeHtml(i.email)}.`
    : `Your account: signed in as ${escapeHtml(i.email)}.`;
  const body =
    hello(i.firstName) +
    para('Welcome to MerchOS. Your free trial has started. Here is what you can do, at no cost and with no card needed:') +
    bullets([
      `Create your first ${i.trialProducts} products free`,
      'Ready-written listings, with corrections included',
      `Export files for ${MARKETPLACES}`,
      'Invite your team, as many people as you like',
      'Free training, even before you subscribe',
    ]) +
    para('Get your first listings live in three steps:') +
    numbered([
      ['Add your products.', 'Upload a supplier file (CSV, Excel or PDF) or product photos, or add products one by one.'],
      ['Write and review your listings.', 'Click "Write my listing". Check each one and correct anything in a click.'],
      ['Export for each marketplace.', 'Download the file Takealot (or any other marketplace) accepts and upload it.'],
    ]) +
    para(account) +
    button('Start my first listing', `${i.siteUrl}/create`);
  return render(
    'Welcome to MerchOS, your free trial has started',
    'Your first products are free. Here is how to get your first listings live.',
    body,
  );
}

// ─── B. Subscription welcome (first payment) ────────────────────────────────

export interface SubscriptionWelcomeInput {
  siteUrl: string;
  firstName?: string | undefined;
  planName: string;
  /** null = custom plan (allowance agreed with the seller). */
  monthlyProducts: number | null;
  /** Products already in the account from the trial. */
  existingProducts: number;
  /** End of the month just paid for (ISO). */
  paidUntil: string;
  /** Card on file, charged automatically each month. */
  autoRenew?: boolean | undefined;
}

/** "22 December 2026" in South African time. */
export function longDate(iso: string): string {
  return new Date(iso).toLocaleDateString('en-ZA', {
    timeZone: 'Africa/Johannesburg',
    day: 'numeric',
    month: 'long',
    year: 'numeric',
  });
}

export function subscriptionWelcome(i: SubscriptionWelcomeInput): RenderedEmail {
  const allowance = i.monthlyProducts === null ? null : `${formatNumber(i.monthlyProducts)} new products`;
  const kept =
    i.existingProducts === 1
      ? 'Your trial product and its listing are still in your account, so you can carry on where you left off.'
      : i.existingProducts > 1
        ? `Your ${formatNumber(i.existingProducts)} trial products and listings are all still in your account, so you can carry on where you left off.`
        : '';
  const body =
    hello(i.firstName) +
    para(
      `Thank you for subscribing. Your <b>${escapeHtml(i.planName)} plan</b> is now active. Here is what is included each month:`,
    ) +
    bullets([
      allowance ? `${allowance} a month` : 'New products as agreed for your plan',
      'Ready-written listings, with corrections included',
      `Export files for ${MARKETPLACES}`,
      'Unlimited team members',
      'Free training, whenever you need it',
    ]) +
    (kept ? para(kept) : '') +
    para('Good to know:') +
    bullets([
      ...(allowance ? [`Your allowance of ${allowance} starts today and resets on the 1st of each month.`] : []),
      i.autoRenew
        ? `Your plan renews on <b>${escapeHtml(longDate(i.paidUntil))}</b> and on the same day each month after that: we charge your card automatically. You can change your plan or stop automatic billing at any time from Billing.`
        : `Your plan is paid until <b>${escapeHtml(longDate(i.paidUntil))}</b>. We will email you a week before, and you pay for the next month from Billing. We never charge you automatically.`,
      'Invoices are in your dashboard under Billing, where you can also change your plan at any time.',
    ]) +
    button('Go to my dashboard', `${i.siteUrl}/dashboard`);
  return render('Thank you for subscribing to MerchOS', `Your ${i.planName} plan is now active.`, body);
}

// ─── 2. Tips (day 2) ─────────────────────────────────────────────────────────

export function tips(i: { siteUrl: string; firstName?: string | undefined }): RenderedEmail {
  const body =
    heading('Three ways to save hours this week') +
    para(`${hi(i.firstName)}these are the features sellers use most in their first week:`) +
    steps([
      [
        'Import a whole supplier file at once',
        'Upload the price list or catalogue your supplier sends you. MerchOS reads every row, creates the products and flags duplicates.',
      ],
      [
        'Corrections are included',
        'Not happy with a title or description? Edit it yourself or click "Rewrite". Corrections never count against your products.',
      ],
      [
        'One click, every marketplace',
        'Export the same products as a Takealot loadsheet or a Shopify or WooCommerce import, without retyping anything.',
      ],
    ]) +
    para('Tip: add the product barcode (EAN) when you have it. Marketplaces ask for it, and it helps avoid duplicate listings.') +
    button('Import my first file', `${i.siteUrl}/imports`);
  return render('Three ways to save hours with MerchOS', 'The features sellers use most in their first week.', body);
}

// ─── 3. Training (day 5) ─────────────────────────────────────────────────────

export function training(i: { siteUrl: string; firstName?: string | undefined }): RenderedEmail {
  const body =
    heading('Your free training is ready to book') +
    para(
      `${hi(i.firstName)}we will walk you through loading your catalogue, writing your listings and exporting the files each marketplace accepts. Choose what suits you:`,
    ) +
    cards([
      ['Weekly group session', 'Join live online, see MerchOS in action and ask questions.'],
      ['One-on-one', 'Online, or in person, arranged with you on a call.'],
      ['Bring your products', 'Work on your real catalogue with us and leave with listings ready to review.'],
    ]) +
    button('Book my training', `${i.siteUrl}/contact?reason=training#training`) +
    para('Prefer to talk first? Reply to this email and we will call you to find a time.');
  return render('Book your free MerchOS training', 'Group, one-on-one, or bring your own products.', body);
}

// ─── 4. Review request (day 30, marketing) ──────────────────────────────────

export interface ReviewRequestInput {
  firstName?: string | undefined;
  listings: number;
  /** Link for each star (1 to 5). */
  starUrl: (rating: number) => string;
  unsubscribeUrl: string;
}

export function reviewRequest(i: ReviewRequestInput): RenderedEmail {
  const body =
    heading('How has your first month been?') +
    para(
      `${hi(i.firstName)}you have created <b>${formatNumber(i.listings)} listings</b> with MerchOS so far. We would love to hear how it is going. It takes about a minute.`,
    ) +
    para('<b>Tap a star to rate MerchOS</b>') +
    starRow(i.starUrl) +
    para(
      'You can add a few words about your experience on the next page. With your permission, we may share your review on our website. We check every review before it appears.',
    ) +
    para('Something not working as it should? Reply to this email and we will sort it out.');
  return render('How has your first month been?', 'Tap a star to rate MerchOS. It takes about a minute.', body, i.unsubscribeUrl);
}

// ─── 5. Referral invite (day 35, marketing) ─────────────────────────────────

export interface ReferralInviteInput {
  siteUrl: string;
  firstName?: string | undefined;
  /** e.g. "merchos.co.za/r/THANDI7K" (shown) */
  linkLabel: string;
  unsubscribeUrl: string;
}

export function referralInvite(i: ReferralInviteInput): RenderedEmail {
  const body =
    heading('Know another seller? Get a month free') +
    para(`${hi(i.firstName)}if MerchOS is saving you time, chances are another seller you know could use it too.`) +
    steps([
      ['Share your personal link', 'Send it to a seller on WhatsApp, email or anywhere you like.'],
      ['They try MerchOS free', 'They get their first 15 products free, no card needed, like you did.'],
      ['You get a month free', 'When they subscribe, stay for 14 days and add at least 10 products, your next monthly payment is skipped.'],
    ]) +
    copyBox('Your personal link', escapeHtml(i.linkLabel)) +
    button('Copy my link', `${i.siteUrl}/referrals`) +
    small(
      'One free month for each seller who subscribes through your link, stays subscribed for 14 days and is actively using MerchOS (at least 10 products added within 90 days of subscribing). There is no limit. Free months are applied to your next payments in order.',
    );
  return render('Refer a seller, get a month free', 'Share your link. When they subscribe, you get a month free.', body, i.unsubscribeUrl);
}

// ─── Internal: new review alert (support mailbox) ───────────────────────────

export interface ReviewAlertInput {
  adminUrl: string;
  rating: number;
  text: string;
  displayName: string;
  businessName?: string | undefined;
  email?: string | undefined;
  consentToPublish: boolean;
}

export function reviewAlert(i: ReviewAlertInput): RenderedEmail {
  const low = i.rating <= 3;
  const who = `${escapeHtml(i.displayName)}${i.businessName ? ` (${escapeHtml(i.businessName)})` : ''}`;
  const body =
    heading(low ? `Low rating: ${i.rating} out of 5` : `New review: ${i.rating} out of 5`) +
    para(`From ${who}${i.email ? `, ${escapeHtml(i.email)}` : ''}.`) +
    para(i.text ? `"${escapeHtml(i.text)}"` : 'No comment left.') +
    para(i.consentToPublish ? 'They agreed it may be shown on the website.' : 'They did not agree to it being shown on the website.') +
    (low ? para('Worth a call: something may not be working for them.') : '') +
    button('Open Reviews', `${i.adminUrl}/reviews`);
  return render(
    `${low ? 'Low rating' : 'New review'}: ${i.rating} stars from ${i.businessName ?? i.displayName}`,
    'A seller left a review. It shows on the website only once approved.',
    body,
  );
}
