'use client';

/**
 * Create Listings (placeholder).
 *
 * Entry point for the core workflow: select marketplace(s) -> upload mixed
 * media (images + PDF + text + video URL) for one or many products -> name the
 * batch -> AI synthesis -> review -> Product CSV per marketplace.
 *
 * This is a deliberate placeholder so the "Create listings" nav item and the
 * dashboard CTA have a destination while the workflow is built. The marketplace
 * selection arrives via ?marketplaces=takealot,amazon from the dashboard picker.
 */

import React from 'react';
import { useSearchParams, useRouter } from 'next/navigation';
import { Card } from '@merch-os/ui';

export default function CreateListingsPage() {
  const params = useSearchParams();
  const router = useRouter();
  const selected = (params.get('marketplaces') ?? '').split(',').filter(Boolean);

  return (
    <div className="mx-auto max-w-3xl space-y-6">
      <div>
        <h1 className="text-xl font-semibold tracking-tight text-gray-900">Create listings</h1>
        <p className="text-sm text-gray-500">
          Upload your product information and let MerchOS build marketplace-ready listings.
        </p>
      </div>

      <Card padding="lg">
        <ol className="space-y-4 text-sm text-gray-700">
          <li className="flex gap-3">
            <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-primary-600 text-xs font-semibold text-white">1</span>
            <div>
              <p className="font-medium text-gray-900">Select marketplaces</p>
              <p className="text-gray-500">
                {selected.length > 0 ? `Selected: ${selected.join(', ')}` : 'Choose one or more marketplaces to target.'}
              </p>
            </div>
          </li>
          <li className="flex gap-3">
            <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-gray-200 text-xs font-semibold text-gray-600">2</span>
            <div>
              <p className="font-medium text-gray-900">Upload product information</p>
              <p className="text-gray-500">Images, PDF, text, and a product video URL, for one or many products.</p>
            </div>
          </li>
          <li className="flex gap-3">
            <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-gray-200 text-xs font-semibold text-gray-600">3</span>
            <div>
              <p className="font-medium text-gray-900">Name your batch</p>
              <p className="text-gray-500">A batch can hold one product or many.</p>
            </div>
          </li>
          <li className="flex gap-3">
            <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-gray-200 text-xs font-semibold text-gray-600">4</span>
            <div>
              <p className="font-medium text-gray-900">Review and approve</p>
              <p className="text-gray-500">Check the generated listings, correct anything, then approve.</p>
            </div>
          </li>
          <li className="flex gap-3">
            <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-gray-200 text-xs font-semibold text-gray-600">5</span>
            <div>
              <p className="font-medium text-gray-900">Download your Product CSV</p>
              <p className="text-gray-500">One Product CSV per marketplace, ready to upload. Set price, stock, and lead time on the marketplace yourself.</p>
            </div>
          </li>
        </ol>

        <div className="mt-6 rounded-md border border-amber-200 bg-amber-50 p-3 text-sm text-amber-800">
          This workflow is being built. The steps above show how it will work.
        </div>

        <div className="mt-4">
          <button
            type="button"
            onClick={() => router.push('/dashboard')}
            className="rounded-md border border-gray-300 bg-white px-4 py-2 text-sm font-medium text-gray-700 shadow-sm hover:bg-gray-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary-600 focus-visible:ring-offset-2"
          >
            Back to dashboard
          </button>
        </div>
      </Card>
    </div>
  );
}
