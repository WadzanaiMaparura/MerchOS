/**
 * Client for the Engagement API (reviews, referrals, email preferences).
 * Public routes need no sign-in; /referrals/* send the Cognito access token.
 */

import { fetchAuthSession } from 'aws-amplify/auth';

export const ENGAGEMENT_API_URL = (process.env.NEXT_PUBLIC_ENGAGEMENT_API_URL ?? '').replace(/\/$/, '');

export class EngagementApiError extends Error {
  constructor(
    message: string,
    public readonly status: number,
  ) {
    super(message);
  }
}

async function call<T>(path: string, init: RequestInit = {}, signedIn = false): Promise<T> {
  if (!ENGAGEMENT_API_URL) throw new EngagementApiError('Not available right now.', 503);
  const headers: Record<string, string> = { 'Content-Type': 'application/json' };
  if (signedIn) {
    const token = (await fetchAuthSession()).tokens?.accessToken?.toString();
    if (!token) throw new EngagementApiError('Please sign in again.', 401);
    headers['Authorization'] = `Bearer ${token}`;
  }
  const res = await fetch(`${ENGAGEMENT_API_URL}${path}`, { ...init, headers: { ...headers, ...init.headers } });
  const body = (await res.json().catch(() => ({}))) as { error?: { message?: string } } & T;
  if (!res.ok) throw new EngagementApiError(body.error?.message ?? 'Something went wrong. Please try again.', res.status);
  return body;
}

// ─── Reviews (public) ───────────────────────────────────────────────────────

export interface PublicReview {
  reviewId: string;
  name: string;
  label: string;
  quote: string;
  rating: number;
}

export async function fetchApprovedReviews(): Promise<PublicReview[]> {
  const { reviews } = await call<{ reviews: PublicReview[] }>('/reviews');
  return reviews;
}

export interface ReviewInvite {
  firstName: string | null;
  suggestedName: string;
  businessName: string;
  alreadyReviewed: boolean;
}

export const fetchReviewInvite = (token: string) =>
  call<ReviewInvite>(`/reviews/invite?t=${encodeURIComponent(token)}`);

export interface ReviewSubmission {
  token: string;
  rating: number;
  text: string;
  displayName: string;
  businessLabel?: string;
  consentToPublish: boolean;
}

export const submitReview = (input: ReviewSubmission) =>
  call<{ reviewId: string; status: string }>('/reviews', { method: 'POST', body: JSON.stringify(input) });

export const unsubscribe = (token: string) =>
  call<{ unsubscribed: boolean }>('/unsubscribe', { method: 'POST', body: JSON.stringify({ token }) });

// ─── Why did you leave? (public, signed link) ───────────────────────────────

export type LeaveReason = 'too_expensive' | 'no_time' | 'business_quiet' | 'other_tool' | 'other';

export const sendLeaveFeedback = (input: { token: string; reason: LeaveReason; comment?: string }) =>
  call<{ saved: boolean }>('/feedback', { method: 'POST', body: JSON.stringify(input) });

// ─── Referrals (signed in) ──────────────────────────────────────────────────

export interface MyReferrals {
  code: string;
  link: string;
  linkLabel: string;
  referrals: Array<{ status: 'PENDING' | 'SUBSCRIBED' | 'QUALIFIED' | 'LAPSED'; claimedAt: string; reward: 'EARNED' | 'APPLIED' | null }>;
  freeMonthsEarned: number;
  freeMonthsApplied: number;
}

export const fetchMyReferrals = () => call<MyReferrals>('/referrals/me', {}, true);

export const claimReferral = (code: string) =>
  call<{ claimed: boolean; alreadyReferred?: boolean }>('/referrals/claim', { method: 'POST', body: JSON.stringify({ code }) }, true);

// ─── Notifications: the bell (signed in) ────────────────────────────────────

export interface SellerNotification {
  id: string;
  kind: string;
  title: string;
  message: string;
  /** Dashboard path to open, e.g. /imports/<id>. */
  link: string;
  at: string;
  read: boolean;
}

export interface NotificationList {
  notifications: SellerNotification[];
  unreadCount: number;
}

export const fetchNotifications = () => call<NotificationList>('/notifications', {}, true);

export const markNotificationsRead = (input: { ids: string[] } | { all: true }) =>
  call<NotificationList>('/notifications/read', { method: 'POST', body: JSON.stringify(input) }, true);

// ─── Referral code captured from /r/<code> ──────────────────────────────────

const STORAGE_KEY = 'merchos.referral';
/** A link followed more than 30 days ago no longer counts. */
const MAX_AGE_MS = 30 * 24 * 60 * 60 * 1000;
export const REFERRAL_CODE = /^[A-Z2-9]{4,12}$/;

export function rememberReferralCode(code: string): void {
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify({ code, at: Date.now() }));
  } catch {
    // Private mode / storage disabled: the referral simply is not recorded.
  }
}

export function storedReferralCode(): string | null {
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) return null;
    const { code, at } = JSON.parse(raw) as { code?: unknown; at?: unknown };
    if (typeof code !== 'string' || !REFERRAL_CODE.test(code) || typeof at !== 'number' || Date.now() - at > MAX_AGE_MS) {
      window.localStorage.removeItem(STORAGE_KEY);
      return null;
    }
    return code;
  } catch {
    return null;
  }
}

export function forgetReferralCode(): void {
  try {
    window.localStorage.removeItem(STORAGE_KEY);
  } catch {
    // ignore
  }
}
