/**
 * Public API (no sign-in). The signed links in emails are the only credential.
 *
 *   GET  /reviews              approved reviews for the website (consented only)
 *   GET  /reviews/invite?t=    who a review link is for (prefills the form)
 *   POST /reviews              leave the one review a tenant may leave (goes to PENDING)
 *   POST /unsubscribe?t=       stop marketing emails (page button, or RFC 8058 one-click)
 *   POST /feedback             why a seller left (the day-60 email), one answer per seller
 *
 * POST /reviews and /feedback also require one of our own origins; one-click unsubscribe is
 * posted by mail providers (no Origin), so it relies on the token alone.
 */

import type { APIGatewayProxyEventV2 } from 'aws-lambda';
import { z } from 'zod';
import { ensureProfile, getOwnerDetails, shortName } from '../lib/accounts';
import { config, getTokenSecret } from '../lib/config';
import {
  badRequest,
  conflict,
  forbidden,
  gone,
  header,
  json,
  notFound,
  readJson,
  serverError,
  sourceIp,
  tooMany,
  type HttpResult,
} from '../lib/http';
import { sendEmail } from '../lib/mailer';
import { LEAVE_REASONS, feedbackAlert, type LeaveReason } from '../lib/billing-templates';
import { createReview, hasReviewed, listReviews, saveFeedback, setMarketingOptOut, withinRateLimit } from '../lib/store';
import { reviewAlert } from '../lib/templates';
import { verifyToken, type TokenPurpose } from '../lib/tokens';

/** How many approved reviews the website can show (placeholder slots it may fill). */
export const PUBLIC_REVIEW_LIMIT = 8;

const reviewSchema = z.object({
  token: z.string().min(10).max(200),
  rating: z.number().int().min(1).max(5),
  text: z.string().trim().max(600).default(''),
  displayName: z.string().trim().min(2, 'Please add the name to show with your review').max(40),
  businessLabel: z.string().trim().max(60).optional(),
  consentToPublish: z.boolean(),
});

const firstIssue = (error: z.ZodError): string => error.issues[0]?.message ?? 'Invalid request';

async function tokenTenant(purpose: TokenPurpose, token: string | undefined): Promise<string | HttpResult> {
  const check = verifyToken(purpose, token, await getTokenSecret());
  if (check.ok) return check.tenantId;
  return check.reason === 'expired'
    ? gone('This link has expired.')
    : badRequest('This link is not valid. Please use the link in your email.');
}

async function publicReviews(): Promise<HttpResult> {
  // A slot on the website needs words; star-only reviews stay internal.
  const approved = (await listReviews('APPROVED', 50))
    .filter((r) => r.consentToPublish && r.text.trim().length > 0)
    .slice(0, PUBLIC_REVIEW_LIMIT);
  return json(
    200,
    {
      reviews: approved.map((r) => ({
        reviewId: r.reviewId,
        name: r.displayName,
        label: r.businessLabel ?? '',
        quote: r.text,
        rating: r.rating,
      })),
    },
    // Cached briefly at the edge/browser: approvals show within minutes.
    { 'Cache-Control': 'public, max-age=300' },
  );
}

async function invite(event: APIGatewayProxyEventV2): Promise<HttpResult> {
  const tenant = await tokenTenant('review', event.queryStringParameters?.['t']);
  if (typeof tenant !== 'string') return tenant;
  const profile = await ensureProfile(tenant);
  if (!profile) return notFound('This account no longer exists.');
  const details = await getOwnerDetails(tenant, profile.userId);
  return json(200, {
    firstName: profile.firstName ?? null,
    suggestedName: shortName(details.fullName) ?? profile.firstName ?? '',
    businessName: profile.businessName ?? '',
    alreadyReviewed: await hasReviewed(tenant),
  });
}

async function submit(event: APIGatewayProxyEventV2): Promise<HttpResult> {
  if (!config.sellerOrigins.includes(header(event, 'origin') ?? '')) return forbidden('Not allowed');
  if (!(await withinRateLimit('review', sourceIp(event), 10, 3600))) {
    return tooMany('Too many attempts. Please try again later.');
  }
  const parsed = reviewSchema.safeParse(readJson(event));
  if (!parsed.success) return badRequest(firstIssue(parsed.error));
  const tenant = await tokenTenant('review', parsed.data.token);
  if (typeof tenant !== 'string') return tenant;

  const profile = await ensureProfile(tenant);
  if (!profile) return notFound('This account no longer exists.');
  const { token: _token, businessLabel, ...fields } = parsed.data;
  const review = await createReview({
    ...fields,
    tenantId: tenant,
    ...(businessLabel ? { businessLabel } : {}),
  });
  if (!review) return conflict('You have already sent us a review. Thank you.');

  // Every review waits for approval; tell the support mailbox (low ratings flagged).
  try {
    const alert = reviewAlert({
      adminUrl: config.adminBaseUrl,
      rating: review.rating,
      text: review.text,
      displayName: review.displayName,
      businessName: profile.businessName,
      email: profile.email,
      consentToPublish: review.consentToPublish,
    });
    await sendEmail({ to: config.supportEmail, ...alert });
  } catch (error) {
    console.error('Review alert not sent', { reviewId: review.reviewId, error: (error as Error).message });
  }
  console.info('Review received', { reviewId: review.reviewId, rating: review.rating });
  return json(201, { reviewId: review.reviewId, status: review.status });
}

const feedbackSchema = z.object({
  token: z.string().min(10).max(200),
  reason: z.enum(LEAVE_REASONS.map(([id]) => id) as [LeaveReason, ...LeaveReason[]]),
  comment: z.string().trim().max(1000).optional(),
});

/** "Why did you leave?" (the day-60 email). One answer per seller; a later one replaces it. */
async function feedback(event: APIGatewayProxyEventV2): Promise<HttpResult> {
  if (!config.sellerOrigins.includes(header(event, 'origin') ?? '')) return forbidden('Not allowed');
  if (!(await withinRateLimit('feedback', sourceIp(event), 10, 3600))) {
    return tooMany('Too many attempts. Please try again later.');
  }
  const parsed = feedbackSchema.safeParse(readJson(event));
  if (!parsed.success) return badRequest(firstIssue(parsed.error));
  const tenant = await tokenTenant('feedback', parsed.data.token);
  if (typeof tenant !== 'string') return tenant;
  const profile = await ensureProfile(tenant);
  if (!profile) return notFound('This account no longer exists.');

  const comment = parsed.data.comment || undefined;
  await saveFeedback({ tenantId: tenant, reason: parsed.data.reason, ...(comment ? { comment } : {}), at: new Date().toISOString() });
  try {
    const label = LEAVE_REASONS.find(([id]) => id === parsed.data.reason)?.[1] ?? parsed.data.reason;
    await sendEmail({
      to: config.supportEmail,
      ...feedbackAlert({ adminUrl: config.adminBaseUrl, reason: label, comment, businessName: profile.businessName, email: profile.email }),
    });
  } catch (error) {
    console.error('Feedback alert not sent', { error: (error as Error).message });
  }
  console.info('Leave feedback received', { reason: parsed.data.reason });
  return json(201, { saved: true });
}

async function unsubscribe(event: APIGatewayProxyEventV2): Promise<HttpResult> {
  let token = event.queryStringParameters?.['t'];
  if (!token) {
    const body = readJson(event) as { token?: unknown } | undefined;
    token = typeof body?.token === 'string' ? body.token : undefined;
  }
  // One-click posts "List-Unsubscribe=One-Click" as a form body; the token is in the URL.
  const tenant = await tokenTenant('unsubscribe', token);
  if (typeof tenant !== 'string') return tenant;
  await setMarketingOptOut(tenant);
  console.info('Marketing opt-out', { tenantId: tenant });
  return json(200, { unsubscribed: true });
}

export async function handler(event: APIGatewayProxyEventV2): Promise<HttpResult> {
  try {
    switch (event.routeKey) {
      case 'GET /reviews':
        return await publicReviews();
      case 'GET /reviews/invite':
        return await invite(event);
      case 'POST /reviews':
        return await submit(event);
      case 'POST /unsubscribe':
        return await unsubscribe(event);
      case 'POST /feedback':
        return await feedback(event);
      default:
        return notFound();
    }
  } catch (err) {
    console.error('Engagement public API failed', { route: event.routeKey, error: (err as Error).message });
    return serverError();
  }
}
