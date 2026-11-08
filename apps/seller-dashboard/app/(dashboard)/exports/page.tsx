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
        <div className="rounded-md border border-amber-200 bg-amber-50 p-3 text-sm text-amber-800">
          CSV generation is being built. Approved batches will appear here with a Product CSV
          to download for each target marketplace.
        </div>
        <p className="mt-3 text-xs text-gray-400">
          MerchOS creates your product listing file. Set price, stock, and lead time on the
          marketplace after uploading.
        </p>
      </Card>
    </div>
  );
}
