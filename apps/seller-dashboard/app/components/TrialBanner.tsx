'use client';

import Link from 'next/link';
import { useTrialUsage } from '@merch-os/api-client';

/**
 * Free-trial usage ("3 of 15 free products used").
 *
 * Renders nothing unless the trial limit is switched on for the platform and the
 * seller is on the trial: subscribed / exempt sellers and the pre-launch state
 * see no banner. Informational only, so a failed lookup simply hides it.
 */
export function TrialBanner({ className = '' }: { className?: string }) {
  const { data } = useTrialUsage();
  if (!data?.enforced || (data.status !== 'trial' && data.status !== 'not_started')) return null;

  const { productsUsed, productLimit, remaining } = data;
  const used = Math.min(productsUsed, productLimit);
  const pct = productLimit > 0 ? Math.round((used / productLimit) * 100) : 100;
  const exhausted = remaining <= 0;

  return (
    <section
      aria-label="Free trial usage"
      className={`rounded-lg border p-4 ${exhausted ? 'border-amber-300 bg-amber-50' : 'border-blue-200 bg-blue-50'} ${className}`}
    >
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div className="min-w-0 flex-1">
          <p className="text-sm font-medium text-gray-900">
            {exhausted
              ? `Your free trial is used up: ${productLimit} of ${productLimit} products created.`
              : `Free trial: ${used} of ${productLimit} products used (${remaining} left).`}
          </p>
          <p className="mt-0.5 text-xs text-gray-600">
            {exhausted
              ? 'You can still edit and correct your trial products. Subscribe to add new products and generate content for them.'
              : 'Products you create, import or generate count towards the trial. Deleting a product does not give it back.'}
          </p>
          <div
            className="mt-2 h-1.5 w-full max-w-sm overflow-hidden rounded-full bg-white"
            role="progressbar"
            aria-valuemin={0}
            aria-valuemax={productLimit}
            aria-valuenow={used}
            aria-label="Free trial products used"
          >
            <div className={`h-full ${exhausted ? 'bg-amber-500' : 'bg-blue-600'}`} style={{ width: `${pct}%` }} />
          </div>
        </div>
        <Link
          href="/billing"
          className="inline-flex shrink-0 items-center justify-center rounded-md bg-blue-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-blue-700 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-600 focus-visible:ring-offset-2"
        >
          {exhausted ? 'Subscribe' : 'See plans'}
        </Link>
      </div>
    </section>
  );
}

/** Seller-facing text for an API error, with trial-specific wording. */
export function describeProductError(err: unknown, fallback: string): string {
  const e = err as { code?: string; message?: string; statusCode?: number } | null;
  if (e?.code === 'TRIAL_LIMIT_REACHED' || e?.code === 'TRIAL_NOT_ACTIVATED') {
    return e.message || 'Your free trial limit has been reached. Subscribe to continue.';
  }
  return e?.message || fallback;
}
