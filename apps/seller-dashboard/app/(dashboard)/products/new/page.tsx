'use client';

/**
 * Create product — POST /products, then (optionally) AI generation.
 *
 * Creates one DRAFT product from what the seller knows. With "Write my listing"
 * ticked, MerchOS then writes the title, description, bullets, attributes and
 * category (POST /products/{id}/synthesize) and the product moves to REVIEW.
 */
import React, { useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useCreateProduct, useSynthesizeProduct, type CreateProductPayload } from '@merch-os/api-client';
import { useRole } from '@merch-os/auth';
import { Alert, Card, Input } from '@merch-os/ui';
import { TrialBanner, describeProductError } from '../../../components/TrialBanner';

interface FormState {
  title: string;
  sku: string;
  brand: string;
  shortDescription: string;
  longDescription: string;
  bulletPoints: string;
  stockQuantity: string;
}

const EMPTY: FormState = {
  title: '',
  sku: '',
  brand: '',
  shortDescription: '',
  longDescription: '',
  bulletPoints: '',
  stockQuantity: '',
};

type Errors = Partial<Record<keyof FormState, string>>;

function validate(f: FormState): Errors {
  const e: Errors = {};
  if (!f.title.trim()) e.title = 'Enter a product title.';
  if (!f.sku.trim()) e.sku = 'Enter a SKU (your own product code).';
  else if (f.sku.trim().length > 100) e.sku = 'SKU must be 100 characters or fewer.';
  if (!f.brand.trim()) e.brand = 'Enter the brand.';
  if (f.stockQuantity.trim() && !/^\d+$/.test(f.stockQuantity.trim())) {
    e.stockQuantity = 'Stock must be a whole number (0 or more).';
  }
  return e;
}

function toPayload(f: FormState): CreateProductPayload {
  const bullets = f.bulletPoints.split(/\r?\n/).map((b) => b.trim()).filter(Boolean);
  return {
    title: f.title.trim(),
    sku: f.sku.trim(),
    brand: f.brand.trim(),
    ...(f.shortDescription.trim() ? { shortDescription: f.shortDescription.trim() } : {}),
    ...(f.longDescription.trim() ? { longDescription: f.longDescription.trim() } : {}),
    ...(bullets.length ? { bulletPoints: bullets } : {}),
    ...(f.stockQuantity.trim() ? { stockQuantity: Number(f.stockQuantity.trim()) } : {}),
  };
}

const textareaClass =
  'mt-1 w-full rounded-md border border-gray-300 px-3 py-2 text-sm text-gray-900 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-600 disabled:bg-gray-50';

export default function NewProductPage() {
  const router = useRouter();
  const role = useRole();
  const createProduct = useCreateProduct();
  const synthesize = useSynthesizeProduct();

  const [form, setForm] = useState<FormState>(EMPTY);
  const [errors, setErrors] = useState<Errors>({});
  const [generate, setGenerate] = useState(true);
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [phase, setPhase] = useState<'idle' | 'saving' | 'generating'>('idle');

  const busy = phase !== 'idle';
  const set = (k: keyof FormState) => (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) =>
    setForm((p) => ({ ...p, [k]: e.target.value }));

  if (role === 'viewer') {
    return (
      <Alert variant="error" title="Access denied">
        Your role can view products but not create them. Ask an account owner or admin for editor access.
      </Alert>
    );
  }

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setSubmitError(null);
    const found = validate(form);
    setErrors(found);
    if (Object.keys(found).length) return;

    setPhase('saving');
    let productId: string;
    try {
      ({ productId } = await createProduct.mutateAsync(toPayload(form)));
    } catch (err) {
      const code = (err as { code?: string })?.code;
      setSubmitError(
        code === 'PRODUCT_SKU_ALREADY_EXISTS'
          ? 'A product with this SKU already exists. Use a different SKU.'
          : describeProductError(err, 'The product could not be created. Please try again.'),
      );
      setPhase('idle');
      return;
    }

    if (generate) {
      setPhase('generating');
      try {
        await synthesize.mutateAsync({ productId });
        router.push(`/products/${encodeURIComponent(productId)}`);
      } catch (err) {
        // The product exists; send the seller to it with the reason.
        const reason = describeProductError(err, 'Listing writing did not complete.');
        router.push(`/products/${encodeURIComponent(productId)}?notice=${encodeURIComponent(reason)}`);
      }
      return;
    }
    router.push(`/products/${encodeURIComponent(productId)}`);
  }

  return (
    <div className="mx-auto flex max-w-3xl flex-col gap-6">
      <div>
        <Link href="/products" className="text-sm text-blue-600 hover:underline">
          ← Products
        </Link>
        <h1 className="mt-2 text-2xl font-semibold text-gray-900">New product</h1>
        <p className="mt-1 text-sm text-gray-500">
          Add what you know. MerchOS writes the rest of the listing, and you review it before export.
        </p>
      </div>

      <TrialBanner />

      {submitError && (
        <div aria-live="assertive">
          <Alert variant="error" title="Not created" dismissible onDismiss={() => setSubmitError(null)}>
            {submitError}
          </Alert>
        </div>
      )}

      <form onSubmit={onSubmit} noValidate aria-label="New product form" className="flex flex-col gap-6">
        <Card title="Basics">
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <div className="sm:col-span-2">
              <Input
                label="Title"
                required
                value={form.title}
                onChange={set('title')}
                disabled={busy}
                placeholder="e.g. 1.7L Stainless Steel Kettle"
                error={errors.title}
                aria-invalid={!!errors.title}
              />
            </div>
            <Input
              label="SKU"
              required
              value={form.sku}
              onChange={set('sku')}
              disabled={busy}
              placeholder="e.g. KET-1700-SS"
              error={errors.sku}
              aria-invalid={!!errors.sku}
            />
            <Input
              label="Brand"
              required
              value={form.brand}
              onChange={set('brand')}
              disabled={busy}
              placeholder="e.g. Acme"
              error={errors.brand}
              aria-invalid={!!errors.brand}
            />
            <Input
              label="Stock on hand"
              inputMode="numeric"
              value={form.stockQuantity}
              onChange={set('stockQuantity')}
              disabled={busy}
              placeholder="0"
              error={errors.stockQuantity}
              aria-invalid={!!errors.stockQuantity}
            />
          </div>
        </Card>

        <Card title="Description (optional)">
          <div className="flex flex-col gap-4">
            <Input
              label="Short description"
              value={form.shortDescription}
              onChange={set('shortDescription')}
              disabled={busy}
              placeholder="One line about the product"
            />
            <div>
              <label htmlFor="longDescription" className="text-sm font-medium text-gray-700">
                Full description
              </label>
              <textarea
                id="longDescription"
                rows={5}
                value={form.longDescription}
                onChange={set('longDescription')}
                disabled={busy}
                placeholder="Materials, size, what's in the box, who it's for…"
                className={textareaClass}
              />
            </div>
            <div>
              <label htmlFor="bulletPoints" className="text-sm font-medium text-gray-700">
                Key features <span className="font-normal text-gray-500">(one per line)</span>
              </label>
              <textarea
                id="bulletPoints"
                rows={4}
                value={form.bulletPoints}
                onChange={set('bulletPoints')}
                disabled={busy}
                className={textareaClass}
              />
            </div>
          </div>
        </Card>

        <label className="flex items-start gap-3 rounded-lg border border-gray-200 bg-white p-4">
          <input
            type="checkbox"
            checked={generate}
            onChange={(e) => setGenerate(e.target.checked)}
            disabled={busy}
            className="mt-0.5 h-4 w-4 rounded border-gray-300 text-blue-600 focus:ring-blue-600"
          />
          <span>
            <span className="block text-sm font-medium text-gray-900">Write my listing</span>
            <span className="block text-xs text-gray-500">
              Writes the title, description, bullet points, attributes and category. You review every field before
              it is exported. Takes up to a minute.
            </span>
          </span>
        </label>

        <div className="flex items-center justify-end gap-3">
          <Link
            href="/products"
            className="rounded-md border border-gray-300 bg-white px-4 py-2 text-sm font-medium text-gray-700 shadow-sm hover:bg-gray-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-600 focus-visible:ring-offset-2"
          >
            Cancel
          </Link>
          <button
            type="submit"
            disabled={busy}
            className="rounded-md bg-blue-600 px-4 py-2 text-sm font-medium text-white shadow-sm hover:bg-blue-700 disabled:cursor-not-allowed disabled:opacity-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-600 focus-visible:ring-offset-2"
          >
            {phase === 'saving' ? 'Creating…' : phase === 'generating' ? 'Writing your listing…' : 'Create product'}
          </button>
        </div>
        <p className="sr-only" aria-live="polite">
          {phase === 'saving' ? 'Creating product' : phase === 'generating' ? 'Generating listing content' : ''}
        </p>
      </form>
    </div>
  );
}
