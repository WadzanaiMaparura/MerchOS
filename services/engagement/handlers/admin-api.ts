/**
 * Admin dashboard API. Cognito JWT authorizer (admin client) on every route.
 *
 * reviewsHandler    RBAC `reviews` (Admin and Support)
 *   GET    /admin/reviews?status=PENDING|APPROVED|REJECTED
 *   POST   /admin/reviews/{reviewId}/approve    shows it on the website (needs the seller's consent)
 *   POST   /admin/reviews/{reviewId}/reject
 *   DELETE /admin/reviews/{reviewId}            POPIA erasure
 *   GET    /admin/feedback                      why sellers left (the day-60 email answers)
 *
 * referralsHandler  RBAC `referrals` update (Admin)
 *   GET    /admin/referrals
 *   POST   /admin/referrals/{referrerTenantId}/{referredTenantId}/applied   free month taken off a payment
 */

import middy from '@middy/core';
import type { APIGatewayProxyEventV2 } from 'aws-lambda';
import { rbacMiddleware } from '../../shared/middleware/rbac';
import { LEAVE_REASONS } from '../lib/billing-templates';
import { badRequest, conflict, json, notFound, serverError, type HttpResult } from '../lib/http';
import {
  REVIEW_STATUSES,
  decideReview,
  deleteReview,
  getProfile,
  getReview,
  listAllReferrals,
  listFeedback,
  listReviews,
  markRewardApplied,
  type ReviewStatus,
} from '../lib/store';

const UUID = /^[a-f0-9-]{36}$/;

function staffId(event: APIGatewayProxyEventV2): string {
  const ctx = event.requestContext as unknown as { authorizer?: { rbac?: { userId?: string } } };
  const id = ctx.authorizer?.rbac?.userId;
  if (!id) throw new Error('No staff identity on the request');
  return id;
}

/** Business names for the admin lists (one lookup per tenant). */
async function businessNames(tenantIds: string[]): Promise<Map<string, string>> {
  const unique = [...new Set(tenantIds)].slice(0, 300);
  const profiles = await Promise.all(unique.map((id) => getProfile(id)));
  const out = new Map<string, string>();
  profiles.forEach((p, i) => out.set(unique[i]!, p?.businessName ?? ''));
  return out;
}

async function reviewsRoute(event: APIGatewayProxyEventV2): Promise<HttpResult> {
  const by = staffId(event);
  const id = event.pathParameters?.['reviewId'];
  if (event.routeKey.includes('{reviewId}') && (!id || !UUID.test(id))) return badRequest('Invalid review id');

  switch (event.routeKey) {
    case 'GET /admin/feedback': {
      const answers = await listFeedback();
      const names = await businessNames(answers.map((a) => a.tenantId));
      return json(200, {
        feedback: answers.map((a) => ({
          ...a,
          label: LEAVE_REASONS.find(([id]) => id === a.reason)?.[1] ?? a.reason,
          businessName: names.get(a.tenantId) ?? '',
        })),
      });
    }
    case 'GET /admin/reviews': {
      const status = (event.queryStringParameters?.['status'] ?? 'PENDING').toUpperCase() as ReviewStatus;
      if (!REVIEW_STATUSES.includes(status)) return badRequest('Unknown status');
      const reviews = await listReviews(status);
      const names = await businessNames(reviews.map((r) => r.tenantId));
      return json(200, { reviews: reviews.map((r) => ({ ...r, businessName: names.get(r.tenantId) ?? '' })) });
    }
    case 'POST /admin/reviews/{reviewId}/approve': {
      const existing = await getReview(id!);
      if (!existing) return notFound('Review not found');
      if (!existing.consentToPublish) {
        return conflict('This seller did not agree to their review being shown on the website.');
      }
      const review = await decideReview(id!, 'APPROVED', by);
      if (!review) return conflict('This review could not be approved.');
      console.info('Review approved', { reviewId: id, by });
      return json(200, { review });
    }
    case 'POST /admin/reviews/{reviewId}/reject': {
      const review = await decideReview(id!, 'REJECTED', by);
      if (!review) return notFound('Review not found');
      console.info('Review rejected', { reviewId: id, by });
      return json(200, { review });
    }
    case 'DELETE /admin/reviews/{reviewId}': {
      const review = await getReview(id!);
      if (!review) return notFound('Review not found');
      await deleteReview(review);
      console.info('Review deleted', { reviewId: id, by });
      return json(200, { deleted: true });
    }
    default:
      return notFound();
  }
}

async function referralsRoute(event: APIGatewayProxyEventV2): Promise<HttpResult> {
  const by = staffId(event);
  switch (event.routeKey) {
    case 'GET /admin/referrals': {
      const referrals = await listAllReferrals();
      const names = await businessNames(referrals.flatMap((r) => [r.referrerTenantId, r.referredTenantId]));
      return json(200, {
        referrals: referrals.map((r) => ({
          ...r,
          referrerBusiness: names.get(r.referrerTenantId) ?? '',
          referredBusiness: names.get(r.referredTenantId) || r.referredBusiness || '',
        })),
      });
    }
    case 'POST /admin/referrals/{referrerTenantId}/{referredTenantId}/applied': {
      const referrer = event.pathParameters?.['referrerTenantId'];
      const referred = event.pathParameters?.['referredTenantId'];
      if (!referrer || !referred || !UUID.test(referrer) || !UUID.test(referred)) return badRequest('Invalid ids');
      if (!(await markRewardApplied(referrer, referred, by))) {
        return conflict('There is no earned free month to mark for this referral.');
      }
      console.info('Referral free month applied', { referrer, referred, by });
      return json(200, { applied: true });
    }
    default:
      return notFound();
  }
}

const safely =
  (fn: (e: APIGatewayProxyEventV2) => Promise<HttpResult>) =>
  async (event: APIGatewayProxyEventV2): Promise<HttpResult> => {
    try {
      return await fn(event);
    } catch (err) {
      console.error('Engagement admin API failed', { route: event.routeKey, error: (err as Error).message });
      return serverError();
    }
  };

export const reviewsHandler = middy(safely(reviewsRoute)).use(rbacMiddleware({ resource: 'reviews', action: 'update' }));
export const referralsHandler = middy(safely(referralsRoute)).use(
  rbacMiddleware({ resource: 'referrals', action: 'update' }),
);
