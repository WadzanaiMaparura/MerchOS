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
        <div className="rounded-md border border-amber-200 bg-amber-50 p-3 text-sm text-amber-800">
          The review workflow is being built. Here you will step through each product in a batch,
          approve or regenerate individual fields (title, description, images, attributes), and
          confirm to generate the Product CSV.
        </div>
      </Card>
    </div>
  );
}
