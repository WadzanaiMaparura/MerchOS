/**
 * Engagement API client (admin): review approval and referral rewards.
 * Cognito access token from the admin session on every call.
 */

import { fetchAuthSession } from 'aws-amplify/auth';

export const ENGAGEMENT_API_URL = (process.env.NEXT_PUBLIC_ENGAGEMENT_API_URL ?? '').replace(/\/$/, '');

export type ReviewStatus = 'PENDING' | 'APPROVED' | 'REJECTED';

export interface AdminReview {
  reviewId: string;
  tenantId: string;
  businessName: string;
  rating: number;
  text: string;
  displayName: string;
  businessLabel?: string;
  consentToPublish: boolean;
  status: ReviewStatus;
  createdAt: string;
  decidedAt?: string;
}

export type ReferralStatus = 'PENDING' | 'SUBSCRIBED' | 'QUALIFIED' | 'LAPSED';

export interface AdminReferral {
  referrerTenantId: string;
  referredTenantId: string;
  referrerBusiness: string;
  referredBusiness: string;
  code: string;
  status: ReferralStatus;
  claimedAt: string;
  subscribedAt?: string;
  qualifyAt?: string;
  qualifiedAt?: string;
  reward?: 'EARNED' | 'APPLIED';
  rewardAppliedAt?: string;
}

export class EngagementApiError extends Error {
  constructor(
    message: string,
    public readonly status: number,
  ) {
    super(message);
  }
}

async function call<T>(path: string, init: RequestInit = {}): Promise<T> {
  const token = (await fetchAuthSession()).tokens?.accessToken?.toString();
  if (!token) throw new EngagementApiError('Your session has expired. Please sign in again.', 401);
  const res = await fetch(`${ENGAGEMENT_API_URL}${path}`, {
    ...init,
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}`, ...init.headers },
  });
  const body = (await res.json().catch(() => ({}))) as { error?: { message?: string } } & T;
  if (!res.ok) throw new EngagementApiError(body.error?.message ?? `Request failed (${res.status})`, res.status);
  return body;
}

export const engagementApi = {
  reviews: async (status: ReviewStatus) =>
    (await call<{ reviews: AdminReview[] }>(`/admin/reviews?status=${status}`)).reviews,
  approve: (id: string) => call(`/admin/reviews/${encodeURIComponent(id)}/approve`, { method: 'POST' }),
  reject: (id: string) => call(`/admin/reviews/${encodeURIComponent(id)}/reject`, { method: 'POST' }),
  remove: (id: string) => call(`/admin/reviews/${encodeURIComponent(id)}`, { method: 'DELETE' }),
  referrals: async () => (await call<{ referrals: AdminReferral[] }>('/admin/referrals')).referrals,
  markApplied: (referrer: string, referred: string) =>
    call(`/admin/referrals/${encodeURIComponent(referrer)}/${encodeURIComponent(referred)}/applied`, { method: 'POST' }),
};
