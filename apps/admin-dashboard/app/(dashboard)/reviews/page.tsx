'use client';

/**
 * Reviews: sellers' reviews from the day-30 email. Nothing shows on the
 * website until it is approved here, and only reviews the seller agreed may be
 * shown can be approved. Approved reviews fill the website's review slots in
 * the order they were approved (first approved = first slot).
 */

import React, { useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { AdminRouteGuard } from '../../../components/AdminRouteGuard';
import { ENGAGEMENT_API_URL, engagementApi, type AdminReview, type ReviewStatus } from '../../../lib/engagement';

const TABS: Array<{ status: ReviewStatus; label: string }> = [
  { status: 'PENDING', label: 'Waiting for approval' },
  { status: 'APPROVED', label: 'On the website' },
  { status: 'REJECTED', label: 'Not shown' },
];

const btn =
  'inline-flex items-center justify-center rounded-md px-3 py-1.5 text-sm font-medium focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-600 focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50';
const btnPrimary = `${btn} bg-blue-600 text-white hover:bg-blue-700`;
const btnSecondary = `${btn} border border-gray-300 bg-white text-gray-700 hover:bg-gray-50`;
const btnDanger = `${btn} border border-red-300 bg-white text-red-700 hover:bg-red-50`;

const formatDate = (iso: string) =>
  new Date(iso).toLocaleString('en-ZA', { day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' });

export default function ReviewsPage() {
  return (
    <AdminRouteGuard requiredResource="reviews">
      {ENGAGEMENT_API_URL ? (
        <Reviews />
      ) : (
        <div className="p-6 text-sm text-gray-600">Reviews are not configured for this environment (NEXT_PUBLIC_ENGAGEMENT_API_URL).</div>
      )}
    </AdminRouteGuard>
  );
}

function Reviews() {
  const [tab, setTab] = useState<ReviewStatus>('PENDING');
  const query = useQuery({ queryKey: ['reviews', tab], queryFn: () => engagementApi.reviews(tab) });

  return (
    <div className="space-y-4 p-4 md:p-6">
      <div>
        <h1 className="text-2xl font-semibold text-gray-900">Reviews</h1>
        <p className="mt-1 text-sm text-gray-600">
          Approve a review to show it on merchos.co.za. Approved reviews take the review slots on the home page in the
          order you approve them; the remaining slots keep their sample reviews.
        </p>
      </div>

      <div role="tablist" aria-label="Review status" className="flex gap-1 border-b border-gray-200">
        {TABS.map((t) => (
          <button
            key={t.status}
            role="tab"
            type="button"
            aria-selected={tab === t.status}
            onClick={() => setTab(t.status)}
            className={`-mb-px border-b-2 px-3 py-2 text-sm font-medium ${
              tab === t.status ? 'border-blue-600 text-blue-700' : 'border-transparent text-gray-600 hover:text-gray-900'
            }`}
          >
            {t.label}
          </button>
        ))}
      </div>

      <div role="tabpanel" className="space-y-3">
        {query.isLoading && <p className="text-sm text-gray-500">Loading…</p>}
        {query.isError && <p className="text-sm text-red-700">{(query.error as Error).message}</p>}
        {query.data?.length === 0 && <p className="text-sm text-gray-500">Nothing here.</p>}
        {query.data?.map((r, i) => (
          <ReviewCard key={r.reviewId} review={r} slot={tab === 'APPROVED' ? i + 1 : undefined} />
        ))}
      </div>
    </div>
  );
}

function ReviewCard({ review: r, slot }: { review: AdminReview; slot?: number | undefined }) {
  const queryClient = useQueryClient();
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [confirmDelete, setConfirmDelete] = useState(false);

  const run = async (label: string, task: () => Promise<unknown>) => {
    setBusy(label);
    setError(null);
    try {
      await task();
      await queryClient.invalidateQueries({ queryKey: ['reviews'] });
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Something went wrong.');
    } finally {
      setBusy(null);
    }
  };

  const low = r.rating <= 3;
  return (
    <article className={`rounded-lg border bg-white p-4 ${low ? 'border-amber-300' : 'border-gray-200'}`}>
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <p className="text-lg text-yellow-500" aria-label={`${r.rating} out of 5 stars`}>
            {'★'.repeat(r.rating)}
            <span className="text-gray-200">{'★'.repeat(5 - r.rating)}</span>
          </p>
          <p className="text-sm font-semibold text-gray-900">
            {r.displayName}
            {r.businessLabel && <span className="font-normal text-gray-600"> · {r.businessLabel}</span>}
          </p>
          <p className="text-xs text-gray-500">
            Account: {r.businessName || r.tenantId} · {formatDate(r.createdAt)}
            {slot !== undefined && <> · website slot {slot}</>}
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          {r.status !== 'APPROVED' && (
            <button
              type="button"
              className={btnPrimary}
              disabled={!!busy || !r.consentToPublish || !r.text.trim()}
              title={
                !r.consentToPublish
                  ? 'The seller did not agree to it being shown'
                  : !r.text.trim()
                    ? 'No words to show (rating only)'
                    : undefined
              }
              onClick={() => void run('approve', () => engagementApi.approve(r.reviewId))}
            >
              {busy === 'approve' ? 'Approving…' : 'Approve for website'}
            </button>
          )}
          {r.status !== 'REJECTED' && (
            <button type="button" className={btnSecondary} disabled={!!busy} onClick={() => void run('reject', () => engagementApi.reject(r.reviewId))}>
              {busy === 'reject' ? 'Saving…' : r.status === 'APPROVED' ? 'Remove from website' : 'Do not show'}
            </button>
          )}
          {confirmDelete ? (
            <span className="flex items-center gap-2 rounded-md border border-red-200 bg-red-50 px-2 py-1 text-xs text-red-800">
              Delete permanently?
              <button type="button" className={btnDanger} disabled={!!busy} onClick={() => void run('delete', () => engagementApi.remove(r.reviewId))}>
                {busy === 'delete' ? 'Deleting…' : 'Yes, delete'}
              </button>
              <button type="button" className={btnSecondary} onClick={() => setConfirmDelete(false)}>
                Cancel
              </button>
            </span>
          ) : (
            <button type="button" className={btnDanger} onClick={() => setConfirmDelete(true)} title="For POPIA deletion requests">
              Delete
            </button>
          )}
        </div>
      </div>
      <p className="mt-3 whitespace-pre-wrap text-sm text-gray-800">{r.text || <em className="text-gray-500">No comment, rating only.</em>}</p>
      <p className="mt-2 text-xs text-gray-500">
        {r.consentToPublish ? 'Agreed it may be shown on the website.' : 'Did not agree to it being shown on the website.'}
        {low && ' Low rating: worth a call to see what is not working.'}
      </p>
      {error && (
        <p role="alert" className="mt-2 text-sm text-red-700">
          {error}
        </p>
      )}
    </article>
  );
}
