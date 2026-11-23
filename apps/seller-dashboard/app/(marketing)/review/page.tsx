'use client';

/**
 * Leave a review: opened from the stars in the review email (?t=<signed link>&r=<1-5>).
 * No sign-in needed; the link is the credential. Reviews show on the website
 * only after the MerchOS team approves them, and only with the seller's consent.
 */

import { Suspense, useEffect, useState } from 'react';
import { useSearchParams } from 'next/navigation';
import {
  EngagementApiError,
  fetchReviewInvite,
  submitReview,
  type ReviewInvite,
} from '../../components/engagement/engagement-api';

const RATING_LABELS = ['', 'Poor', 'Fair', 'Good', 'Very good', 'Excellent'];

export default function ReviewPage() {
  return (
    <section className="py-12 sm:py-16">
      <div className="mx-auto max-w-xl px-6">
        <Suspense fallback={<p className="text-sm text-gray-500">Loading…</p>}>
          <ReviewForm />
        </Suspense>
      </div>
    </section>
  );
}

function ReviewForm() {
  const params = useSearchParams();
  const token = params?.get('t') ?? '';
  const initialRating = Number(params?.get('r'));

  const [invite, setInvite] = useState<ReviewInvite | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [rating, setRating] = useState(initialRating >= 1 && initialRating <= 5 ? Math.round(initialRating) : 0);
  const [text, setText] = useState('');
  const [displayName, setDisplayName] = useState('');
  const [businessLabel, setBusinessLabel] = useState('');
  const [consent, setConsent] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState(false);

  useEffect(() => {
    if (!token) {
      setLoadError('This link is not complete. Please use the link in your email.');
      return;
    }
    fetchReviewInvite(token)
      .then((i) => {
        setInvite(i);
        setDisplayName(i.suggestedName);
        setBusinessLabel(i.businessName);
      })
      .catch((err: unknown) => setLoadError(err instanceof Error ? err.message : 'This link is not valid.'));
  }, [token]);

  if (loadError) return <Message title="We could not open your review">{loadError}</Message>;
  if (!invite) return <p className="text-sm text-gray-500">Loading…</p>;
  if (done || invite.alreadyReviewed) {
    return (
      <Message title="Thank you">
        {done
          ? 'We have your review. We read every one, and if you agreed, it may appear on our website once we have checked it.'
          : 'You have already sent us a review. Thank you for taking the time.'}
      </Message>
    );
  }

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    if (!rating) return setError('Please choose a star rating.');
    setBusy(true);
    try {
      await submitReview({
        token,
        rating,
        text: text.trim(),
        displayName: displayName.trim(),
        ...(businessLabel.trim() ? { businessLabel: businessLabel.trim() } : {}),
        consentToPublish: consent,
      });
      setDone(true);
    } catch (err) {
      if (err instanceof EngagementApiError && err.status === 409) setDone(true);
      else setError(err instanceof Error ? err.message : 'Something went wrong. Please try again.');
    } finally {
      setBusy(false);
    }
  };

  const input =
    'mt-1 block w-full rounded-lg border border-gray-300 px-3 py-2 text-sm text-gray-900 focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-500/30';

  return (
    <form onSubmit={(e) => void submit(e)} className="rounded-2xl border border-gray-100 bg-white p-6 shadow-sm sm:p-8" noValidate>
      <h1 className="text-2xl font-bold text-gray-900">
        {invite.firstName ? `${invite.firstName}, how has MerchOS been for you?` : 'How has MerchOS been for you?'}
      </h1>
      <p className="mt-2 text-sm text-gray-600">It takes about a minute. We read every review.</p>

      <fieldset className="mt-6">
        <legend className="text-sm font-semibold text-gray-900">Your rating</legend>
        <div className="mt-2 flex gap-2" role="radiogroup">
          {[1, 2, 3, 4, 5].map((n) => (
            <label key={n} className="cursor-pointer">
              <input
                type="radio"
                name="rating"
                value={n}
                checked={rating === n}
                onChange={() => setRating(n)}
                className="peer sr-only"
              />
              <span
                aria-hidden="true"
                className={`flex h-11 w-11 items-center justify-center rounded-lg border text-2xl peer-focus-visible:ring-2 peer-focus-visible:ring-blue-500 ${
                  n <= rating ? 'border-yellow-300 bg-yellow-50 text-yellow-400' : 'border-gray-200 text-gray-300'
                }`}
              >
                ★
              </span>
              <span className="sr-only">
                {n} star{n > 1 ? 's' : ''}, {RATING_LABELS[n]}
              </span>
            </label>
          ))}
        </div>
        {rating > 0 && <p className="mt-1 text-xs text-gray-500">{RATING_LABELS[rating]}</p>}
      </fieldset>

      <label className="mt-6 block">
        <span className="text-sm font-semibold text-gray-900">Tell us about your experience</span>
        <span className="block text-xs text-gray-500">Optional. What has MerchOS helped you with?</span>
        <textarea className={`${input} min-h-[110px]`} maxLength={600} value={text} onChange={(e) => setText(e.target.value)} />
        <span className="block text-right text-xs text-gray-400">{text.length}/600</span>
      </label>

      <div className="mt-4 grid gap-4 sm:grid-cols-2">
        <label className="block">
          <span className="text-sm font-semibold text-gray-900">Name to show</span>
          <input className={input} maxLength={40} value={displayName} onChange={(e) => setDisplayName(e.target.value)} required />
        </label>
        <label className="block">
          <span className="text-sm font-semibold text-gray-900">Business or category</span>
          <input className={input} maxLength={60} value={businessLabel} onChange={(e) => setBusinessLabel(e.target.value)} placeholder="e.g. Home & Kitchen" />
        </label>
      </div>

      <label className="mt-5 flex items-start gap-3 text-sm text-gray-700">
        <input
          type="checkbox"
          className="mt-0.5 h-4 w-4 rounded border-gray-300 text-blue-600 focus:ring-blue-500"
          checked={consent}
          onChange={(e) => setConsent(e.target.checked)}
        />
        <span>
          MerchOS may show my review, with the name and business above, on its website. We check every review before
          it appears, and you can ask us to remove it at any time.
        </span>
      </label>

      {error && (
        <p role="alert" className="mt-4 rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">
          {error}
        </p>
      )}

      <button
        type="submit"
        disabled={busy}
        className="mt-6 w-full rounded-xl bg-[#2563EB] px-6 py-3 text-sm font-semibold text-white hover:bg-blue-700 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:ring-offset-2 disabled:opacity-60"
      >
        {busy ? 'Sending…' : 'Send my review'}
      </button>
      <p className="mt-3 text-center text-xs text-gray-500">
        Something not working? Email <a className="text-blue-700 underline" href="mailto:info@merchos.co.za">info@merchos.co.za</a> and we will sort it out.
      </p>
    </form>
  );
}

function Message({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="rounded-2xl border border-gray-100 bg-white p-8 text-center shadow-sm" role="status">
      <h1 className="text-2xl font-bold text-gray-900">{title}</h1>
      <p className="mt-3 text-sm text-gray-600">{children}</p>
      <a href="/" className="mt-6 inline-block text-sm font-semibold text-blue-700 underline">
        Back to merchos.co.za
      </a>
    </div>
  );
}
