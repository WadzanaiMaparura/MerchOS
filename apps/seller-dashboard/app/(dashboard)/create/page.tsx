'use client';

/**
 * Create Listings — full multi-step UI shell (frontend only, awaiting backend).
 *
 * The seller's core workflow:
 *   1. Select target marketplace(s)
 *   2. Upload product information (images, PDF, text) + a product video URL
 *   3. Name the batch
 *   4. Generate (AI synthesis) -> then Review -> Product CSV per marketplace
 *
 * This page renders the complete interface so sellers can see and interact with
 * every step. Uploads are staged client-side; "Generate listings" shows a clear
 * "being connected" state. No backend calls yet.
 */

import React, { useCallback, useMemo, useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { Card, FileUpload } from '@merch-os/ui';

const MARKETPLACES = [
  { id: 'takealot', name: 'Takealot' },
  { id: 'amazon', name: 'Amazon' },
  { id: 'shopify', name: 'Shopify' },
  { id: 'makro', name: 'Makro' },
  { id: 'woocommerce', name: 'WooCommerce' },
];

export default function CreateListingsPage() {
  const router = useRouter();
  const params = useSearchParams();

  const preselected = useMemo(
    () => (params.get('marketplaces') ?? '').split(',').filter(Boolean),
    [params],
  );

  const [selected, setSelected] = useState<string[]>(preselected);
  const [batchName, setBatchName] = useState('');
  const [videoUrl, setVideoUrl] = useState('');
  const [files, setFiles] = useState<File[]>([]);
  const [notes, setNotes] = useState('');

  const toggle = (id: string) =>
    setSelected((p) => (p.includes(id) ? p.filter((x) => x !== id) : [...p, id]));

  const onFiles = useCallback((picked: File[]) => {
    setFiles((prev) => [...prev, ...picked]);
  }, []);

  const removeFile = (idx: number) => setFiles((prev) => prev.filter((_, i) => i !== idx));

  const canGenerate = selected.length > 0 && batchName.trim().length > 0 && files.length > 0;

  return (
    <div className="mx-auto max-w-3xl space-y-6">
      <div>
        <h1 className="text-xl font-semibold tracking-tight text-gray-900">Create listings</h1>
        <p className="text-sm text-gray-500">
          Upload your product information and MerchOS builds marketplace-ready listings for review.
        </p>
      </div>

      {/* Step 1 — marketplaces */}
      <Card padding="lg">
        <StepHeader n={1} title="Select marketplaces" done={selected.length > 0} />
        <div className="mt-3 flex flex-wrap gap-2">
          {MARKETPLACES.map((m) => {
            const on = selected.includes(m.id);
            return (
              <button
                key={m.id}
                type="button"
                onClick={() => toggle(m.id)}
                aria-pressed={on}
                className={`rounded-md border px-3 py-1.5 text-sm font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary-600 focus-visible:ring-offset-2 ${
                  on
                    ? 'border-primary-600 bg-primary-600 text-white'
                    : 'border-gray-300 bg-white text-gray-700 hover:border-gray-400'
                }`}
              >
                {m.name}
              </button>
            );
          })}
        </div>
      </Card>

      {/* Step 2 — upload */}
      <Card padding="lg">
        <StepHeader n={2} title="Upload product information" done={files.length > 0} />
        <p className="mt-1 text-sm text-gray-500">
          Add images, PDFs, and text for one or many products. MerchOS synthesises these into
          complete listings.
        </p>
        <div className="mt-3">
          <FileUpload
            aria-label="Upload product files"
            multiple
            acceptedTypes={['image/*', 'application/pdf', 'text/csv', 'application/vnd.ms-excel', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', 'text/plain']}
            hint="Images, PDF, CSV/Excel, or text. Up to 10 MB each."
            onFilesSelected={onFiles}
          />
        </div>

        {files.length > 0 && (
          <ul className="mt-3 divide-y divide-gray-100 rounded-md border border-gray-200">
            {files.map((f, i) => (
              <li key={`${f.name}-${i}`} className="flex items-center justify-between px-3 py-2 text-sm">
                <span className="truncate text-gray-700">{f.name}</span>
                <button type="button" onClick={() => removeFile(i)} className="text-xs font-medium text-gray-500 hover:text-red-600">
                  Remove
                </button>
              </li>
            ))}
          </ul>
        )}

        <div className="mt-4">
          <label className="text-sm font-medium text-gray-700">Additional notes (optional)</label>
          <textarea
            rows={3}
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
            placeholder="Anything that helps describe the product(s): key features, materials, target use."
            className="mt-1 w-full rounded-md border border-gray-300 px-3 py-2 text-sm text-gray-900 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary-600"
          />
        </div>

        <div className="mt-4">
          <label className="text-sm font-medium text-gray-700">Product video URL (optional)</label>
          <input
            type="url"
            value={videoUrl}
            onChange={(e) => setVideoUrl(e.target.value)}
            placeholder="https://youtu.be/your-product-video"
            className="mt-1 w-full rounded-md border border-gray-300 px-3 py-2 text-sm text-gray-900 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary-600"
          />
          <p className="mt-1 text-xs text-gray-500">
            Paste a link to your product video. MerchOS adds this link to your marketplace CSV as is.
            We do not host or process the video, so make sure the link is public and stays live.
          </p>
        </div>
      </Card>

      {/* Step 3 — name batch */}
      <Card padding="lg">
        <StepHeader n={3} title="Name this batch" done={batchName.trim().length > 0} />
        <input
          type="text"
          value={batchName}
          onChange={(e) => setBatchName(e.target.value)}
          placeholder="e.g. November trampolines"
          className="mt-3 w-full rounded-md border border-gray-300 px-3 py-2 text-sm text-gray-900 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary-600"
        />
        <p className="mt-1 text-xs text-gray-500">A batch can hold one product or many.</p>
      </Card>

      {/* Generate */}
      <div className="flex items-center justify-between gap-3">
        <button
          type="button"
          onClick={() => router.push('/dashboard')}
          className="rounded-md border border-gray-300 bg-white px-4 py-2 text-sm font-medium text-gray-700 shadow-sm hover:bg-gray-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary-600 focus-visible:ring-offset-2"
        >
          Cancel
        </button>
        <button
          type="button"
          disabled={!canGenerate}
          title={canGenerate ? 'Generate listings' : 'Select a marketplace, upload files, and name the batch'}
          className="inline-flex items-center gap-2 rounded-md bg-primary-600 px-5 py-2 text-sm font-semibold text-white shadow-sm transition-colors hover:bg-primary-700 disabled:cursor-not-allowed disabled:bg-primary-600/40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary-600 focus-visible:ring-offset-2"
        >
          Generate listings
        </button>
      </div>

      <p className="text-center text-xs text-gray-400">
        Generation connects to the MerchOS synthesis engine. This step is being wired up.
      </p>
    </div>
  );
}

function StepHeader({ n, title, done }: { n: number; title: string; done: boolean }) {
  return (
    <div className="flex items-center gap-3">
      <span
        className={`flex h-6 w-6 shrink-0 items-center justify-center rounded-full text-xs font-semibold ${
          done ? 'bg-primary-600 text-white' : 'bg-gray-200 text-gray-600'
        }`}
      >
        {n}
      </span>
      <h2 className="text-sm font-semibold text-gray-900">{title}</h2>
    </div>
  );
}
