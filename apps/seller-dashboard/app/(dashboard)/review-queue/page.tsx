'use client';

/**
 * Review Queue (placeholder).
 *
 * Lists batches/products in the "Needs review" stage. Opening one leads to the
 * per-product review screen (approve / edit / regenerate per field, validated
 * against each target marketplace's required fields, gated by
 * "Approve & generate CSV").
 *
 * Deliberate placeholder so the nav item and dashboard "Review" buttons have a
 * destination while the review workflow is built.
 */

import React from 'react';
import { Card } from '@merch-os/ui';

export default function ReviewQueuePage() {
  return (
    <div className="mx-auto max-w-4xl space-y-6">
      <div>
        <h1 className="text-xl font-semibold tracking-tight text-gray-900">Review queue</h1>
        <p className="text-sm text-gray-500">
          Generated listings awaiting your approval. Review each product, correct anything, then approve to generate the CSV.
        </p>
      </div>
      <Card padding="lg">
        <div className="flex flex-col items-center justify-center py-14 text-center">
          <div className="mb-4 flex h-12 w-12 items-center justify-center rounded-full bg-gray-100 text-gray-400">
            <svg
              className="h-6 w-6"
              fill="none"
              viewBox="0 0 24 24"
              stroke="currentColor"
              strokeWidth={1.5}
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                d="M9 12.75 11.25 15 15 9.75M21 12a9 9 0 1 1-18 0 9 9 0 0 1 18 0Z"
              />
            </svg>
          </div>
          <h2 className="text-sm font-semibold text-gray-900">Nothing to review yet</h2>
          <p className="mt-1 max-w-md text-sm text-gray-500">
            Generated listings will appear here once you create a batch. You will step through each
            product, approve or regenerate individual fields, then confirm to generate the Product CSV.
          </p>
          <a
            href="/create"
            className="mt-5 inline-flex items-center rounded-md bg-primary-600 px-4 py-2 text-sm font-medium text-white hover:bg-primary-700"
          >
            Create listings
          </a>
        </div>
      </Card>
    </div>
  );
}
