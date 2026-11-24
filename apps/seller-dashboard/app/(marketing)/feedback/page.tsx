'use client';

/**
 * "Why did you leave?" (from the email sent 60 days after a plan ran out).
 * Opened with ?t=<signed link>&r=<answer>. The seller confirms with a button,
 * so link scanners that open every URL cannot answer for them.
 */

import { Suspense, useState } from 'react';
import { useSearchParams } from 'next/navigation';
import { sendLeaveFeedback, type LeaveReason } from '../../components/engagement/engagement-api';

const REASONS: Array<{ id: LeaveReason; label: string; reply: string }> = [
  {
    id: 'too_expensive',
    label: 'It is too expensive',
    reply:
      'Thank you for telling us. Starter is R499 a month for 500 new products, and you can change plan at any time. If price is what stops you, reply to our email and we will see what we can do.',
  },
  {
    id: 'no_time',
    label: 'I do not have the time right now',
    reply:
      'Thank you for telling us. Our free training loads your catalogue with you, so it takes far less of your time. Reply to our email and we will book a session that suits you.',
  },
  {
    id: 'business_quiet',
    label: 'My business is quiet',
    reply:
      'Thank you for telling us. Your products stay safe, so when things pick up you can come back and carry on where you left off.',
  },
  {
    id: 'other_tool',
    label: 'I use something else',
    reply:
      'Thank you for telling us. If something was missing in MerchOS, we would really like to know what. Tell us below.',
  },
  { id: 'other', label: 'Something else', reply: 'Thank you for telling us. Anything you add below helps us improve.' },
];

export default function FeedbackPage() {
  return (
    <section className="py-12 sm:py-16">
      <div className="mx-auto max-w-lg px-6">
        <Suspense fallback={<p className="text-sm text-gray-500">Loading…</p>}>
          <Feedback />
        </Suspense>
      </div>
    </section>
  );
}

function Feedback() {
  const params = useSearchParams();
  const token = params?.get('t') ?? '';
  const initial = REASONS.find((r) => r.id === params?.get('r'))?.id ?? '';
  const [reason, setReason] = useState<LeaveReason | ''>(initial);
  const [comment, setComment] = useState('');
  const [state, setState] = useState<'ready' | 'busy' | 'done'>('ready');
  const [error, setError] = useState<string | null>(null);
  const chosen = REASONS.find((r) => r.id === reason);

  const send = async () => {
    if (!reason) return;
    setState('busy');
    setError(null);
    try {
      await sendLeaveFeedback({ token, reason, ...(comment.trim() ? { comment: comment.trim() } : {}) });
      setState('done');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Something went wrong. Please try again.');
      setState('ready');
    }
  };

  if (state === 'done') {
    return (
      <div className="rounded-2xl border border-gray-100 bg-white p-8 text-center shadow-sm" role="status">
        <h1 className="text-2xl font-bold text-gray-900">Thank you</h1>
        <p className="mt-3 text-sm text-gray-600">{chosen?.reply}</p>
        <a href="/login" className="mt-6 inline-block text-sm font-semibold text-blue-700 underline">
          Sign in to MerchOS
        </a>
      </div>
    );
  }

  return (
    <div className="rounded-2xl border border-gray-100 bg-white p-8 shadow-sm">
      <h1 className="text-2xl font-bold text-gray-900">Why did you leave MerchOS?</h1>
      <p className="mt-2 text-sm text-gray-600">It helps us make MerchOS better for sellers like you.</p>
      {!token && <p className="mt-4 text-sm text-red-700">This link is not complete. Please use the link in your email.</p>}
      <fieldset className="mt-5">
        <legend className="sr-only">Your answer</legend>
        <div className="space-y-2">
          {REASONS.map((r) => (
            <label
              key={r.id}
              className={`flex cursor-pointer items-center gap-3 rounded-lg border px-4 py-3 text-sm ${
                reason === r.id ? 'border-blue-500 bg-blue-50' : 'border-gray-200 hover:border-blue-300'
              }`}
            >
              <input type="radio" name="reason" value={r.id} checked={reason === r.id} onChange={() => setReason(r.id)} className="h-4 w-4" />
              {r.label}
            </label>
          ))}
        </div>
      </fieldset>
      <label className="mt-4 block text-sm font-medium text-gray-700">
        Anything else you would like to tell us? (optional)
        <textarea
          value={comment}
          onChange={(e) => setComment(e.target.value)}
          maxLength={1000}
          rows={3}
          className="mt-1 block w-full rounded-md border border-gray-300 px-3 py-2 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-600"
        />
      </label>
      {error && (
        <p role="alert" className="mt-4 rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">
          {error}
        </p>
      )}
      <button
        type="button"
        onClick={() => void send()}
        disabled={!token || !reason || state === 'busy'}
        className="mt-6 w-full rounded-xl bg-[#2563EB] px-6 py-3 text-sm font-semibold text-white hover:bg-blue-700 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:ring-offset-2 disabled:opacity-60"
      >
        {state === 'busy' ? 'Sending…' : 'Send my answer'}
      </button>
    </div>
  );
}
