'use client';

/**
 * Takealot Export — validate a product against its Takealot loadsheet schema,
 * then generate a downloadable loadsheet (CSV or XLSX).
 *
 * This wires the seller dashboard to the Export API (@merch-os/export): the
 * validate step is a hard gate — export generation is only offered once a
 * product passes with zero ERROR findings.
 *
 * It operates on a product selected from the seller's catalogue. The canonical
 * product fields known to the DTO are passed through; the validation engine
 * reports anything the Takealot category requires but is missing, so the seller
 * sees exactly what to fix before exporting.
 */

import React, { useMemo, useState } from 'react';
import { Card, Alert, Badge, useToast } from '@merch-os/ui';
import {
  useProducts,
  useCanonicalProduct,
  useValidateProduct,
  useGenerateExport,
  exportResultToBlob,
  type ValidateProductPayload,
} from '@merch-os/api-client';
import type { CanonicalProduct, ValidationResult } from '@merch-os/types';

/**
 * Apply the user-chosen Takealot category onto the fetched canonical product.
 * The product may already carry a mapping; the form value takes precedence so
 * the seller can validate against a specific category without mutating storage.
 */
function withCategory(product: CanonicalProduct, category: string): CanonicalProduct {
  if (!category.trim()) return product;
  return {
    ...product,
    platformSpecific: {
      ...product.platformSpecific,
      categoryMappings: { ...product.platformSpecific.categoryMappings, takealot: category },
    },
  };
}

function Findings({ result }: { result: ValidationResult }) {
  if (result.findings.length === 0) {
    return (
      <Alert variant="success" title="Passed validation">
        This product meets the Takealot requirements for its category and can be exported.
      </Alert>
    );
  }
  const order = { ERROR: 0, WARNING: 1, INFO: 2 } as const;
  const sorted = [...result.findings].sort(
    (a, b) => order[a.severity] - order[b.severity]
  );
  return (
    <div className="space-y-2">
      <div className="flex gap-2 text-xs">
        <Badge variant="error">{result.errorCount} errors</Badge>
        <Badge variant="warning">{result.warningCount} warnings</Badge>
        <Badge variant="neutral">{result.infoCount} info</Badge>
      </div>
      <ul className="divide-y divide-gray-100 rounded-md border border-gray-200">
        {sorted.map((f, i) => (
          <li key={`${f.code}-${f.field}-${i}`} className="flex items-start gap-3 p-3">
            <span
              className={
                'mt-0.5 inline-flex shrink-0 rounded px-1.5 py-0.5 text-[10px] font-semibold uppercase ' +
                (f.severity === 'ERROR'
                  ? 'bg-red-100 text-red-700'
                  : f.severity === 'WARNING'
                    ? 'bg-amber-100 text-amber-700'
                    : 'bg-gray-100 text-gray-600')
              }
            >
              {f.severity}
            </span>
            <div className="min-w-0">
              <p className="text-sm text-gray-900">{f.message}</p>
              <p className="text-xs text-gray-500">
                {f.platformField} ({f.code})
                {f.suggestion ? ` — ${f.suggestion}` : ''}
              </p>
            </div>
          </li>
        ))}
      </ul>
    </div>
  );
}

export default function ExportsPage() {
  const toast = useToast();
  const { data, isLoading } = useProducts({ page: 1, pageSize: 50 });
  const validate = useValidateProduct();
  const generate = useGenerateExport();

  const [selectedId, setSelectedId] = useState('');
  const [category, setCategory] = useState('Accessories->Eyewear (29451)');
  const [format, setFormat] = useState<'CSV' | 'XLSX'>('CSV');
  const [result, setResult] = useState<ValidationResult | null>(null);

  const products = data?.items ?? [];

  // Fetch the full canonical product (enrichment merged) for the selection.
  const { data: fetched, isFetching: isFetchingCanonical } = useCanonicalProduct(
    selectedId,
    { enabled: !!selectedId }
  );

  const canonical = useMemo(
    () => (fetched ? withCategory(fetched, category) : null),
    [fetched, category]
  );

  const onValidate = async () => {
    if (!canonical) return;
    setResult(null);
    try {
      const payload: ValidateProductPayload = { product: canonical, category };
      const r = await validate.mutateAsync(payload);
      setResult(r);
      toast.toast({
        variant: r.exportAllowed ? 'success' : 'warning',
        title: r.exportAllowed ? 'Validation passed' : 'Validation found issues',
        description: `${r.errorCount} errors, ${r.warningCount} warnings`,
      });
    } catch {
      toast.toast({ variant: 'error', title: 'Validation request failed' });
    }
  };

  const onExport = async () => {
    if (!canonical) return;
    try {
      const res = await generate.mutateAsync({
        products: [{ product: canonical, category }],
        mode: 'full-create',
        format,
      });
      const blob = exportResultToBlob(res.export);
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = res.export.filename;
      a.click();
      URL.revokeObjectURL(url);
      toast.toast({
        variant: 'success',
        title: 'Export generated',
        description: `${res.export.filename} (${res.export.rowCount} row)`,
      });
    } catch {
      // A 409 means the product failed validation server-side (the hard gate).
      toast.toast({
        variant: 'error',
        title: 'Export blocked',
        description: 'The product did not pass validation. Fix the errors and retry.',
      });
    }
  };

  const canExport = result?.exportAllowed === true;

  return (
    <div className="mx-auto max-w-4xl space-y-6">
      <div>
        <h1 className="text-xl font-semibold tracking-tight text-gray-900">Takealot Export</h1>
        <p className="text-sm text-gray-500">
          Validate a product against its Takealot category, then download a loadsheet.
        </p>
      </div>

      <Card padding="lg">
        <div className="space-y-4">
          <div>
            <label className="mb-1 block text-sm font-medium text-gray-700" htmlFor="product">
              Product
            </label>
            <select
              id="product"
              className="w-full rounded-md border border-gray-300 px-3 py-2 text-sm"
              value={selectedId}
              onChange={(e) => {
                setSelectedId(e.target.value);
                setResult(null);
              }}
              disabled={isLoading}
            >
              <option value="">{isLoading ? 'Loading products…' : 'Select a product'}</option>
              {products.map((p) => (
                <option key={p.productId} value={p.productId}>
                  {p.title} ({p.sku})
                </option>
              ))}
            </select>
          </div>

          <div>
            <label className="mb-1 block text-sm font-medium text-gray-700" htmlFor="category">
              Takealot category
            </label>
            <input
              id="category"
              type="text"
              className="w-full rounded-md border border-gray-300 px-3 py-2 text-sm"
              value={category}
              onChange={(e) => {
                setCategory(e.target.value);
                setResult(null);
              }}
              placeholder="e.g. Accessories->Eyewear (29451)"
            />
            <p className="mt-1 text-xs text-gray-500">
              The lowest-level Takealot category, including its node id in brackets.
            </p>
          </div>

          <div className="flex items-center gap-3">
            <label className="text-sm font-medium text-gray-700" htmlFor="format">
              Format
            </label>
            <select
              id="format"
              className="rounded-md border border-gray-300 px-3 py-2 text-sm"
              value={format}
              onChange={(e) => setFormat(e.target.value as 'CSV' | 'XLSX')}
            >
              <option value="CSV">CSV</option>
              <option value="XLSX">XLSX (loadsheet)</option>
            </select>
          </div>

          <div className="flex gap-3 pt-2">
            <button
              type="button"
              onClick={onValidate}
              disabled={!canonical || isFetchingCanonical || validate.isPending}
              className="inline-flex items-center rounded-md bg-primary-600 px-4 py-2 text-sm font-medium text-white hover:bg-primary-700 disabled:cursor-not-allowed disabled:opacity-50"
            >
              {isFetchingCanonical ? 'Loading product…' : validate.isPending ? 'Validating…' : 'Validate'}
            </button>
            <button
              type="button"
              onClick={onExport}
              disabled={!canExport || generate.isPending}
              className="inline-flex items-center rounded-md border border-gray-300 bg-white px-4 py-2 text-sm font-medium text-gray-700 hover:bg-gray-50 disabled:cursor-not-allowed disabled:opacity-50"
              title={canExport ? '' : 'Validate successfully before exporting'}
            >
              {generate.isPending ? 'Generating…' : 'Generate export'}
            </button>
          </div>
        </div>
      </Card>

      {result && (
        <Card padding="lg">
          <h2 className="mb-3 text-sm font-semibold text-gray-900">Validation</h2>
          <Findings result={result} />
        </Card>
      )}
    </div>
  );
}
