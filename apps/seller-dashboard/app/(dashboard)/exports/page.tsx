'use client';

/**
 * Exports (placeholder).
 *
 * Lists all batches with generated Product CSVs, downloadable per marketplace.
 * Deliberate placeholder so the nav item and dashboard "Ready to download"
 * links have a destination while the export generation is wired.
 */

import React from 'react';
import { Card } from '@merch-os/ui';

export default function ExportsPage() {
  return (
    <div className="mx-auto max-w-4xl space-y-6">
      <div>
        <h1 className="text-xl font-semibold tracking-tight text-gray-900">Exports</h1>
        <p className="text-sm text-gray-500">
          Your generated Product CSVs, downloadable per marketplace.
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
                d="M3 16.5v2.25A2.25 2.25 0 0 0 5.25 21h13.5A2.25 2.25 0 0 0 21 18.75V16.5M16.5 12 12 16.5m0 0L7.5 12m4.5 4.5V3"
              />
            </svg>
          </div>
          <h2 className="text-sm font-semibold text-gray-900">No exports yet</h2>
          <p className="mt-1 max-w-md text-sm text-gray-500">
            Approved batches will appear here with a Product CSV to download for each target
            marketplace. Set price, stock, and lead time on the marketplace after uploading.
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
