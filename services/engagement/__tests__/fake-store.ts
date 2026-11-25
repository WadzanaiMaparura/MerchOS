/**
 * In-memory stand-in for lib/store.ts with the same conditional semantics
 * (first-write-wins, once-only). The real conditions are exercised by the
 * live end-to-end run against DynamoDB.
 */

import { randomUUID } from 'node:crypto';
import type { LeaveFeedback, NewReview, Profile, Referral, ReferralStatus, Review } from '../lib/store';

export const mem = {
  profiles: new Map<string, Profile>(),
  sent: new Map<string, { messageId?: string }>(),
  codes: new Map<string, string>(),
  referrals: new Map<string, Referral>(),
  reviews: new Map<string, Review>(),
  reviewed: new Set<string>(),
  feedback: new Map<string, LeaveFeedback>(),
  reset() {
    this.feedback.clear();
    this.profiles.clear();
    this.sent.clear();
    this.codes.clear();
    this.referrals.clear();
    this.reviews.clear();
    this.reviewed.clear();
  },
};

const rk = (a: string, b: string) => `${a}|${b}`;

export const fakeStore = {
  REVIEW_STATUSES: ['PENDING', 'APPROVED', 'REJECTED'],
  REFERRAL_STATUSES: ['PENDING', 'SUBSCRIBED', 'QUALIFIED', 'LAPSED'],
  db: () => {
    throw new Error('db() is not available in tests');
  },
  isConditionalFailure: () => false,
  getProfile: async (t: string) => mem.profiles.get(t) ?? null,
  putProfileIfAbsent: async (p: Profile) => {
    if (!mem.profiles.has(p.tenantId)) mem.profiles.set(p.tenantId, { ...p });
    return mem.profiles.get(p.tenantId)!;
  },
  markFirstSubscription: async (t: string, planId: string, at: string) => {
    const p = mem.profiles.get(t);
    if (!p || p.subscribedAt) return false;
    Object.assign(p, { subscribedAt: at, planId });
    return true;
  },
  setMarketingOptOut: async (t: string) => {
    const p = mem.profiles.get(t);
    if (!p) return false;
    p.marketingOptOut = true;
    return true;
  },
  claimSend: async (t: string, key: string) => {
    if (mem.sent.has(rk(t, key))) return false;
    mem.sent.set(rk(t, key), {});
    return true;
  },
  wasSent: async (t: string, key: string) => mem.sent.has(rk(t, key)),
  releaseSend: async (t: string, key: string) => void mem.sent.delete(rk(t, key)),
  recordSent: async (t: string, key: string, messageId?: string) => void mem.sent.set(rk(t, key), { messageId }),
  reserveReferralCode: async (t: string, code: string) => {
    const p = mem.profiles.get(t);
    if (mem.codes.has(code) || !p || p.referralCode) return false;
    mem.codes.set(code, t);
    p.referralCode = code;
    return true;
  },
  tenantForReferralCode: async (code: string) => mem.codes.get(code) ?? null,
  createReferral: async (r: Referral) => {
    const p = mem.profiles.get(r.referredTenantId);
    if (!p || p.referredByTenantId || p.subscribedAt) return false;
    if (mem.referrals.has(rk(r.referrerTenantId, r.referredTenantId))) return false;
    p.referredByTenantId = r.referrerTenantId;
    mem.referrals.set(rk(r.referrerTenantId, r.referredTenantId), { ...r });
    return true;
  },
  getReferral: async (a: string, b: string) => mem.referrals.get(rk(a, b)) ?? null,
  transitionReferral: async (a: string, b: string, from: ReferralStatus[], to: ReferralStatus, fields = {}) => {
    const r = mem.referrals.get(rk(a, b));
    if (!r || !from.includes(r.status)) return false;
    Object.assign(r, fields, { status: to });
    return true;
  },
  markRewardApplied: async (a: string, b: string, by: string) => {
    const r = mem.referrals.get(rk(a, b));
    if (r?.reward !== 'EARNED') return false;
    Object.assign(r, { reward: 'APPLIED', rewardAppliedBy: by });
    return true;
  },
  listReferralsBy: async (a: string) => [...mem.referrals.values()].filter((r) => r.referrerTenantId === a),
  listAllReferrals: async () => [...mem.referrals.values()],
  createReview: async (input: NewReview) => {
    if (mem.reviewed.has(input.tenantId)) return null;
    const review: Review = { ...input, reviewId: randomUUID(), status: 'PENDING', createdAt: new Date().toISOString() };
    mem.reviewed.add(input.tenantId);
    mem.reviews.set(review.reviewId, review);
    return review;
  },
  hasReviewed: async (t: string) => mem.reviewed.has(t),
  getReview: async (id: string) => mem.reviews.get(id) ?? null,
  listReviews: async (status: string) => [...mem.reviews.values()].filter((r) => r.status === status),
  decideReview: async (id: string, status: 'APPROVED' | 'REJECTED', by: string) => {
    const r = mem.reviews.get(id);
    if (!r || (status === 'APPROVED' && !r.consentToPublish)) return null;
    Object.assign(r, { status, decidedBy: by });
    return r;
  },
  deleteReview: async (r: Review) => {
    mem.reviews.delete(r.reviewId);
    mem.reviewed.delete(r.tenantId);
  },
  withinRateLimit: async () => true,
  saveFeedback: async (f: LeaveFeedback) => void mem.feedback.set(f.tenantId, { ...f }),
  listFeedback: async () => [...mem.feedback.values()],
};
