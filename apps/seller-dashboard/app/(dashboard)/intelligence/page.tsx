'use client';

import React, { useState, useCallback } from 'react';

// ─── Types ───────────────────────────────────────────────────────────────────

type GenerationType =
  | 'title'
  | 'description'
  | 'bullets'
  | 'seo'
  | 'category'
  | 'brand'
  | 'attributes'
  | 'keywords'
  | 'compliance';

type MarketplaceId = 'amazon' | 'shopify' | 'ebay' | '';

interface GenerationOptions {
  tone?: 'professional' | 'casual' | 'luxury';
  wordCountMin?: number;
  wordCountMax?: number;
  bulletCount?: number;
  competitorKeywords?: string;
}

interface GenerationResult {
  resultId: string;
  type: GenerationType;
  status: 'completed' | 'failed';
  content: unknown;
  confidenceScore: number;
  reviewRecommended: boolean;
  metadata: {
    promptVersion: number;
    promptTemplateId: string;
    tokenUsage: { inputTokens: number; outputTokens: number };
    cached: boolean;
    modelId: string;
    latencyMs: number;
    marketplace?: string;
    marketplaceCompliance?: 'compliant' | 'warnings' | 'non_compliant';
  };
  error?: { code: string; message: string };
  createdAt: string;
}

// ─── Constants ───────────────────────────────────────────────────────────────

const GENERATION_TYPES: { value: GenerationType; label: string }[] = [
  { value: 'title', label: 'Product Title' },
  { value: 'description', label: 'Product Description' },
  { value: 'bullets', label: 'Bullet Points' },
  { value: 'seo', label: 'SEO Optimization' },
  { value: 'category', label: 'Category Prediction' },
  { value: 'brand', label: 'Brand Detection' },
  { value: 'attributes', label: 'Attribute Extraction' },
  { value: 'keywords', label: 'Keyword Generation' },
  { value: 'compliance', label: 'Compliance Validation' },
];

const MARKETPLACES: { value: MarketplaceId; label: string }[] = [
  { value: '', label: 'None (Generic)' },
  { value: 'amazon', label: 'Amazon' },
  { value: 'shopify', label: 'Shopify' },
  { value: 'ebay', label: 'eBay' },
];

const TONES: { value: 'professional' | 'casual' | 'luxury'; label: string }[] = [
  { value: 'professional', label: 'Professional' },
  { value: 'casual', label: 'Casual' },
  { value: 'luxury', label: 'Luxury' },
];

// ─── Loading Spinner ─────────────────────────────────────────────────────────

function LoadingSpinner() {
  return (
    <svg
      className="animate-spin h-5 w-5 text-white"
      xmlns="http://www.w3.org/2000/svg"
      fill="none"
      viewBox="0 0 24 24"
      aria-hidden="true"
    >
      <circle
        className="opacity-25"
        cx="12"
        cy="12"
        r="10"
        stroke="currentColor"
        strokeWidth="4"
      />
      <path
        className="opacity-75"
        fill="currentColor"
        d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"
      />
    </svg>
  );
}

// ─── Result Display ──────────────────────────────────────────────────────────

function ResultDisplay({ result }: { result: GenerationResult }) {
  const confidenceColor =
    result.confidenceScore >= 0.7
      ? 'bg-green-100 text-green-800'
      : result.confidenceScore >= 0.5
        ? 'bg-amber-100 text-amber-800'
        : 'bg-red-100 text-red-800';

  return (
    <div className="rounded-lg border border-gray-200 bg-white p-6 shadow-sm">
      <div className="flex items-center justify-between mb-4">
        <h3 className="text-lg font-medium text-gray-900">Generation Result</h3>
        <div className="flex items-center gap-2">
          <span
            className={`inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-medium ${confidenceColor}`}
          >
            Confidence: {(result.confidenceScore * 100).toFixed(0)}%
          </span>
          {result.reviewRecommended && (
            <span className="inline-flex items-center rounded-full bg-amber-100 px-2.5 py-0.5 text-xs font-medium text-amber-800">
              Review Recommended
            </span>
          )}
        </div>
      </div>

      {result.status === 'failed' && result.error && (
        <div className="rounded-md bg-red-50 border border-red-200 p-4 mb-4">
          <p className="text-sm text-red-800">
            <span className="font-medium">Error:</span> {result.error.message}
          </p>
        </div>
      )}

      {result.status === 'completed' && (
        <div className="rounded-md bg-gray-50 border border-gray-200 p-4 mb-4">
          <pre className="text-sm text-gray-800 whitespace-pre-wrap break-words">
            {JSON.stringify(result.content, null, 2)}
          </pre>
        </div>
      )}

      <div className="flex items-center gap-4 text-xs text-gray-500">
        <span>
          Tokens: {result.metadata.tokenUsage.inputTokens} in / {result.metadata.tokenUsage.outputTokens} out
        </span>
        <span>Latency: {result.metadata.latencyMs}ms</span>
        {result.metadata.cached && <span className="text-blue-600">Cached</span>}
        {result.metadata.marketplaceCompliance && (
          <span
            className={
              result.metadata.marketplaceCompliance === 'compliant'
                ? 'text-green-600'
                : result.metadata.marketplaceCompliance === 'warnings'
                  ? 'text-amber-600'
                  : 'text-red-600'
            }
          >
            Marketplace: {result.metadata.marketplaceCompliance}
          </span>
        )}
      </div>
    </div>
  );
}

// ─── Error Display ───────────────────────────────────────────────────────────

function ErrorDisplay({ message, onDismiss }: { message: string; onDismiss: () => void }) {
  return (
    <div className="rounded-md bg-red-50 border border-red-200 p-4">
      <div className="flex items-start justify-between">
        <p className="text-sm text-red-800">{message}</p>
        <button
          type="button"
          onClick={onDismiss}
          className="ml-4 text-red-500 hover:text-red-700 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-red-500 rounded"
          aria-label="Dismiss error"
        >
          <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" aria-hidden="true">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
          </svg>
        </button>
      </div>
    </div>
  );
}

// ─── Dynamic Options Section ─────────────────────────────────────────────────

function GenerationOptionsForm({
  generationType,
  options,
  onChange,
}: {
  generationType: GenerationType;
  options: GenerationOptions;
  onChange: (options: GenerationOptions) => void;
}) {
  if (generationType === 'description') {
    return (
      <div className="space-y-4">
        <div>
          <label htmlFor="tone" className="block text-sm font-medium text-gray-700 mb-1">
            Tone
          </label>
          <select
            id="tone"
            value={options.tone ?? 'professional'}
            onChange={(e) => onChange({ ...options, tone: e.target.value as GenerationOptions['tone'] })}
            className="block w-full rounded-md border border-gray-300 bg-white px-3 py-2 text-sm shadow-sm focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500"
          >
            {TONES.map((tone) => (
              <option key={tone.value} value={tone.value}>
                {tone.label}
              </option>
            ))}
          </select>
        </div>
        <div className="grid grid-cols-2 gap-4">
          <div>
            <label htmlFor="wordCountMin" className="block text-sm font-medium text-gray-700 mb-1">
              Min Word Count
            </label>
            <input
              id="wordCountMin"
              type="number"
              min={10}
              max={2000}
              value={options.wordCountMin ?? 100}
              onChange={(e) => onChange({ ...options, wordCountMin: parseInt(e.target.value, 10) || 100 })}
              className="block w-full rounded-md border border-gray-300 px-3 py-2 text-sm shadow-sm focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500"
            />
          </div>
          <div>
            <label htmlFor="wordCountMax" className="block text-sm font-medium text-gray-700 mb-1">
              Max Word Count
            </label>
            <input
              id="wordCountMax"
              type="number"
              min={10}
              max={2000}
              value={options.wordCountMax ?? 300}
              onChange={(e) => onChange({ ...options, wordCountMax: parseInt(e.target.value, 10) || 300 })}
              className="block w-full rounded-md border border-gray-300 px-3 py-2 text-sm shadow-sm focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500"
            />
          </div>
        </div>
      </div>
    );
  }

  if (generationType === 'bullets') {
    return (
      <div>
        <label htmlFor="bulletCount" className="block text-sm font-medium text-gray-700 mb-1">
          Number of Bullets
        </label>
        <input
          id="bulletCount"
          type="number"
          min={1}
          max={20}
          value={options.bulletCount ?? 5}
          onChange={(e) => onChange({ ...options, bulletCount: parseInt(e.target.value, 10) || 5 })}
          className="block w-full rounded-md border border-gray-300 px-3 py-2 text-sm shadow-sm focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500"
        />
        <p className="mt-1 text-xs text-gray-500">Between 1 and 20 bullet points (default: 5)</p>
      </div>
    );
  }

  if (generationType === 'keywords') {
    return (
      <div>
        <label htmlFor="competitorKeywords" className="block text-sm font-medium text-gray-700 mb-1">
          Competitor Keywords (optional)
        </label>
        <textarea
          id="competitorKeywords"
          rows={3}
          value={options.competitorKeywords ?? ''}
          onChange={(e) => onChange({ ...options, competitorKeywords: e.target.value })}
          placeholder="Enter competitor keywords separated by commas for gap analysis..."
          className="block w-full rounded-md border border-gray-300 px-3 py-2 text-sm shadow-sm placeholder:text-gray-400 focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500"
        />
        <p className="mt-1 text-xs text-gray-500">
          Provide competitor keywords to identify gap opportunities
        </p>
      </div>
    );
  }

  return null;
}

// ─── Page Component ──────────────────────────────────────────────────────────

/**
 * IntelligencePage — AI Content Generation page for the seller dashboard.
 *
 * Allows sellers to select a product, choose generation types, configure options,
 * and submit generation requests to the Intelligence Engine API.
 *
 * Validates: Requirements 18.1
 */
export default function IntelligencePage() {
  // Form state
  const [productName, setProductName] = useState('');
  const [productDescription, setProductDescription] = useState('');
  const [productCategory, setProductCategory] = useState('');
  const [productBrand, setProductBrand] = useState('');
  const [generationType, setGenerationType] = useState<GenerationType>('title');
  const [marketplace, setMarketplace] = useState<MarketplaceId>('');
  const [options, setOptions] = useState<GenerationOptions>({
    tone: 'professional',
    wordCountMin: 100,
    wordCountMax: 300,
    bulletCount: 5,
    competitorKeywords: '',
  });

  // Submission state
  const [isLoading, setIsLoading] = useState(false);
  const [result, setResult] = useState<GenerationResult | null>(null);
  const [error, setError] = useState<string | null>(null);

  const handleGenerationTypeChange = useCallback((newType: GenerationType) => {
    setGenerationType(newType);
    // Reset type-specific options when switching types
    setOptions({
      tone: 'professional',
      wordCountMin: 100,
      wordCountMax: 300,
      bulletCount: 5,
      competitorKeywords: '',
    });
  }, []);

  const handleSubmit = useCallback(
    async (e: React.FormEvent) => {
      e.preventDefault();
      setError(null);
      setResult(null);
      setIsLoading(true);

      // Build request body
      const requestBody: Record<string, unknown> = {
        type: generationType,
        productData: {
          name: productName || undefined,
          description: productDescription || undefined,
          category: productCategory || undefined,
          brand: productBrand || undefined,
        },
        ...(marketplace && { marketplace }),
      };

      // Attach type-specific options
      if (generationType === 'description') {
        requestBody.options = {
          tone: options.tone,
          wordCountRange: {
            min: options.wordCountMin,
            max: options.wordCountMax,
          },
        };
      } else if (generationType === 'bullets') {
        requestBody.options = {
          count: options.bulletCount,
        };
      } else if (generationType === 'keywords' && options.competitorKeywords) {
        requestBody.options = {
          competitorKeywords: options.competitorKeywords
            .split(',')
            .map((k) => k.trim())
            .filter(Boolean),
        };
      }

      try {
        const response = await fetch('/api/intelligence/generate', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(requestBody),
        });

        if (!response.ok) {
          const errorData = await response.json().catch(() => null);
          const errorMessage =
            errorData?.error?.message ?? `Request failed with status ${response.status}`;
          setError(errorMessage);
          return;
        }

        const data: GenerationResult = await response.json();
        setResult(data);
      } catch (err) {
        setError(err instanceof Error ? err.message : 'An unexpected error occurred');
      } finally {
        setIsLoading(false);
      }
    },
    [generationType, productName, productDescription, productCategory, productBrand, marketplace, options]
  );

  const isFormValid = productName.trim().length > 0 || productDescription.trim().length > 0;

  return (
    <div className="flex flex-col gap-6 max-w-3xl">
      {/* Page Header */}
      <div>
        <h1 className="text-2xl font-semibold text-gray-900">AI Content Generation</h1>
        <p className="mt-1 text-sm text-gray-600">
          Generate optimized product content using AI. Select a generation type and provide product information to get started.
        </p>
      </div>

      {/* Generation Form */}
      <form onSubmit={handleSubmit} className="space-y-6">
        {/* Product Information Section */}
        <div className="rounded-lg border border-gray-200 bg-white p-6 shadow-sm">
          <h2 className="text-base font-medium text-gray-900 mb-4">Product Information</h2>
          <div className="space-y-4">
            <div>
              <label htmlFor="productName" className="block text-sm font-medium text-gray-700 mb-1">
                Product Name
              </label>
              <input
                id="productName"
                type="text"
                value={productName}
                onChange={(e) => setProductName(e.target.value)}
                placeholder="e.g., Premium Wireless Bluetooth Headphones"
                className="block w-full rounded-md border border-gray-300 px-3 py-2 text-sm shadow-sm placeholder:text-gray-400 focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500"
              />
            </div>
            <div>
              <label htmlFor="productDescription" className="block text-sm font-medium text-gray-700 mb-1">
                Product Description
              </label>
              <textarea
                id="productDescription"
                rows={4}
                value={productDescription}
                onChange={(e) => setProductDescription(e.target.value)}
                placeholder="Describe your product features, materials, use cases..."
                className="block w-full rounded-md border border-gray-300 px-3 py-2 text-sm shadow-sm placeholder:text-gray-400 focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500"
              />
            </div>
            <div className="grid grid-cols-2 gap-4">
              <div>
                <label htmlFor="productCategory" className="block text-sm font-medium text-gray-700 mb-1">
                  Category
                </label>
                <input
                  id="productCategory"
                  type="text"
                  value={productCategory}
                  onChange={(e) => setProductCategory(e.target.value)}
                  placeholder="e.g., Electronics > Audio > Headphones"
                  className="block w-full rounded-md border border-gray-300 px-3 py-2 text-sm shadow-sm placeholder:text-gray-400 focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500"
                />
              </div>
              <div>
                <label htmlFor="productBrand" className="block text-sm font-medium text-gray-700 mb-1">
                  Brand
                </label>
                <input
                  id="productBrand"
                  type="text"
                  value={productBrand}
                  onChange={(e) => setProductBrand(e.target.value)}
                  placeholder="e.g., Sony, Apple, Samsung"
                  className="block w-full rounded-md border border-gray-300 px-3 py-2 text-sm shadow-sm placeholder:text-gray-400 focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500"
                />
              </div>
            </div>
          </div>
        </div>

        {/* Generation Configuration Section */}
        <div className="rounded-lg border border-gray-200 bg-white p-6 shadow-sm">
          <h2 className="text-base font-medium text-gray-900 mb-4">Generation Settings</h2>
          <div className="space-y-4">
            <div>
              <label htmlFor="generationType" className="block text-sm font-medium text-gray-700 mb-1">
                Generation Type
              </label>
              <select
                id="generationType"
                value={generationType}
                onChange={(e) => handleGenerationTypeChange(e.target.value as GenerationType)}
                className="block w-full rounded-md border border-gray-300 bg-white px-3 py-2 text-sm shadow-sm focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500"
              >
                {GENERATION_TYPES.map((type) => (
                  <option key={type.value} value={type.value}>
                    {type.label}
                  </option>
                ))}
              </select>
            </div>

            <div>
              <label htmlFor="marketplace" className="block text-sm font-medium text-gray-700 mb-1">
                Target Marketplace
              </label>
              <select
                id="marketplace"
                value={marketplace}
                onChange={(e) => setMarketplace(e.target.value as MarketplaceId)}
                className="block w-full rounded-md border border-gray-300 bg-white px-3 py-2 text-sm shadow-sm focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500"
              >
                {MARKETPLACES.map((mp) => (
                  <option key={mp.value} value={mp.value}>
                    {mp.label}
                  </option>
                ))}
              </select>
            </div>
          </div>
        </div>

        {/* Dynamic Options Section */}
        {(generationType === 'description' || generationType === 'bullets' || generationType === 'keywords') && (
          <div className="rounded-lg border border-gray-200 bg-white p-6 shadow-sm">
            <h2 className="text-base font-medium text-gray-900 mb-4">Options</h2>
            <GenerationOptionsForm
              generationType={generationType}
              options={options}
              onChange={setOptions}
            />
          </div>
        )}

        {/* Submit Button */}
        <button
          type="submit"
          disabled={!isFormValid || isLoading}
          className="inline-flex items-center justify-center gap-2 rounded-md bg-blue-600 px-6 py-2.5 text-sm font-medium text-white shadow-sm hover:bg-blue-700 disabled:cursor-not-allowed disabled:opacity-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-600 focus-visible:ring-offset-2"
          aria-busy={isLoading}
        >
          {isLoading && <LoadingSpinner />}
          {isLoading ? 'Generating...' : 'Generate Content'}
        </button>
      </form>

      {/* Error Display */}
      {error && <ErrorDisplay message={error} onDismiss={() => setError(null)} />}

      {/* Result Display */}
      {result && <ResultDisplay result={result} />}
    </div>
  );
}
