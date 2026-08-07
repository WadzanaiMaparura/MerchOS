'use client';

import React, { useState, useCallback } from 'react';

// ─── Types ───────────────────────────────────────────────────────────────────

/**
 * Represents a single generation result from the Intelligence Engine.
 */
export interface GenerationResultData {
  resultId: string;
  type: string;
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

export interface GenerationResultProps {
  /** One or more generation results to display */
  results: GenerationResultData[];
  /** Callback when user approves a result (receives resultId and edited content) */
  onApprove?: (resultId: string, editedContent: string) => void;
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

/**
 * Returns Tailwind classes for confidence score badge color coding.
 * Green ≥ 0.7, amber 0.5–0.7, red < 0.5
 */
function getConfidenceClasses(score: number): string {
  if (score >= 0.7) return 'bg-green-100 text-green-800';
  if (score >= 0.5) return 'bg-amber-100 text-amber-800';
  return 'bg-red-100 text-red-800';
}

/**
 * Returns Tailwind classes for marketplace compliance badge.
 */
function getComplianceClasses(status: 'compliant' | 'warnings' | 'non_compliant'): string {
  switch (status) {
    case 'compliant':
      return 'bg-green-100 text-green-800';
    case 'warnings':
      return 'bg-amber-100 text-amber-800';
    case 'non_compliant':
      return 'bg-red-100 text-red-800';
  }
}

/**
 * Formats compliance status for display.
 */
function formatComplianceLabel(status: 'compliant' | 'warnings' | 'non_compliant'): string {
  switch (status) {
    case 'compliant':
      return 'Compliant';
    case 'warnings':
      return 'Warnings';
    case 'non_compliant':
      return 'Non-Compliant';
  }
}

/**
 * Extracts displayable text from generated content.
 */
function extractContentText(content: unknown): string {
  if (content === null || content === undefined) return '';
  if (typeof content === 'string') return content;
  if (typeof content === 'object') {
    const obj = content as Record<string, unknown>;
    // Handle common content shapes
    if ('title' in obj && typeof obj.title === 'string') return obj.title;
    if ('description' in obj && typeof obj.description === 'string') return obj.description;
    if ('bullets' in obj && Array.isArray(obj.bullets)) return obj.bullets.join('\n');
    if ('optimizedContent' in obj && typeof obj.optimizedContent === 'string') return obj.optimizedContent;
    return JSON.stringify(content, null, 2);
  }
  return String(content);
}

// ─── Single Result Card ──────────────────────────────────────────────────────

function SingleResultCard({
  result,
  onApprove,
}: {
  result: GenerationResultData;
  onApprove?: (resultId: string, editedContent: string) => void;
}) {
  const [isEditing, setIsEditing] = useState(false);
  const [editedContent, setEditedContent] = useState(() => extractContentText(result.content));
  const [approved, setApproved] = useState(false);

  const handleApprove = useCallback(() => {
    setApproved(true);
    setIsEditing(false);
    onApprove?.(result.resultId, editedContent);
  }, [result.resultId, editedContent, onApprove]);

  const handleEdit = useCallback(() => {
    setIsEditing(true);
  }, []);

  const handleCancelEdit = useCallback(() => {
    setIsEditing(false);
    setEditedContent(extractContentText(result.content));
  }, [result.content]);

  const confidenceClasses = getConfidenceClasses(result.confidenceScore);

  return (
    <div className="rounded-lg border border-gray-200 bg-white p-6 shadow-sm">
      {/* Header with badges */}
      <div className="flex items-center justify-between mb-4">
        <h3 className="text-lg font-medium text-gray-900">
          {result.type.charAt(0).toUpperCase() + result.type.slice(1)} Result
        </h3>
        <div className="flex items-center gap-2 flex-wrap">
          {/* Confidence score badge */}
          <span
            className={`inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-medium ${confidenceClasses}`}
          >
            Confidence: {(result.confidenceScore * 100).toFixed(0)}%
          </span>

          {/* Review recommended badge (amber when confidence < 0.7) */}
          {result.reviewRecommended && (
            <span className="inline-flex items-center rounded-full bg-amber-100 px-2.5 py-0.5 text-xs font-medium text-amber-800">
              Review Recommended
            </span>
          )}

          {/* Marketplace compliance badge */}
          {result.metadata.marketplaceCompliance && (
            <span
              className={`inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-medium ${getComplianceClasses(result.metadata.marketplaceCompliance)}`}
            >
              {formatComplianceLabel(result.metadata.marketplaceCompliance)}
            </span>
          )}

          {/* Approved badge */}
          {approved && (
            <span className="inline-flex items-center rounded-full bg-green-100 px-2.5 py-0.5 text-xs font-medium text-green-800">
              ✓ Approved
            </span>
          )}
        </div>
      </div>

      {/* Error display for failed results */}
      {result.status === 'failed' && result.error && (
        <div className="rounded-md bg-red-50 border border-red-200 p-4 mb-4">
          <p className="text-sm text-red-800">
            <span className="font-medium">Error:</span> {result.error.message}
          </p>
        </div>
      )}

      {/* Content display with inline editing */}
      {result.status === 'completed' && (
        <div className="mb-4">
          {isEditing ? (
            <div className="space-y-2">
              <textarea
                value={editedContent}
                onChange={(e) => setEditedContent(e.target.value)}
                rows={6}
                className="block w-full rounded-md border border-blue-300 px-3 py-2 text-sm shadow-sm focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500"
                aria-label="Edit generated content"
              />
              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={handleApprove}
                  className="inline-flex items-center rounded-md bg-green-600 px-3 py-1.5 text-xs font-medium text-white shadow-sm hover:bg-green-700 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-green-600 focus-visible:ring-offset-2"
                >
                  Save & Approve
                </button>
                <button
                  type="button"
                  onClick={handleCancelEdit}
                  className="inline-flex items-center rounded-md border border-gray-300 bg-white px-3 py-1.5 text-xs font-medium text-gray-700 shadow-sm hover:bg-gray-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-gray-500 focus-visible:ring-offset-2"
                >
                  Cancel
                </button>
              </div>
            </div>
          ) : (
            <div className="rounded-md bg-gray-50 border border-gray-200 p-4">
              <pre className="text-sm text-gray-800 whitespace-pre-wrap break-words">
                {editedContent}
              </pre>
            </div>
          )}
        </div>
      )}

      {/* Token usage and metadata */}
      <div className="flex items-center gap-4 text-xs text-gray-500 mb-3">
        <span>
          Tokens: {result.metadata.tokenUsage.inputTokens} in / {result.metadata.tokenUsage.outputTokens} out
        </span>
        <span>Latency: {result.metadata.latencyMs}ms</span>
        {result.metadata.cached && <span className="text-blue-600">Cached</span>}
      </div>

      {/* Action buttons */}
      {result.status === 'completed' && !approved && !isEditing && (
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={handleApprove}
            className="inline-flex items-center rounded-md bg-green-600 px-4 py-2 text-sm font-medium text-white shadow-sm hover:bg-green-700 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-green-600 focus-visible:ring-offset-2"
          >
            Approve
          </button>
          <button
            type="button"
            onClick={handleEdit}
            className="inline-flex items-center rounded-md border border-gray-300 bg-white px-4 py-2 text-sm font-medium text-gray-700 shadow-sm hover:bg-gray-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-gray-500 focus-visible:ring-offset-2"
          >
            Edit
          </button>
        </div>
      )}
    </div>
  );
}

// ─── Comparison View ─────────────────────────────────────────────────────────

function ComparisonView({
  results,
  onApprove,
}: {
  results: GenerationResultData[];
  onApprove?: (resultId: string, editedContent: string) => void;
}) {
  return (
    <div className="space-y-4">
      <h2 className="text-lg font-medium text-gray-900">
        Compare Alternatives ({results.length} results)
      </h2>
      <div
        className="grid gap-4"
        style={{ gridTemplateColumns: `repeat(${Math.min(results.length, 3)}, minmax(0, 1fr))` }}
      >
        {results.map((result) => (
          <SingleResultCard key={result.resultId} result={result} onApprove={onApprove} />
        ))}
      </div>
    </div>
  );
}

// ─── Main Component ──────────────────────────────────────────────────────────

/**
 * GenerationResult — Displays one or more AI generation results with confidence scoring,
 * compliance status, side-by-side comparison, and inline editing/approval.
 *
 * Validates: Requirements 18.2, 18.3, 18.4, 18.6
 */
export function GenerationResult({ results, onApprove }: GenerationResultProps) {
  if (results.length === 0) {
    return null;
  }

  // Single result: render a single card
  if (results.length === 1) {
    return <SingleResultCard result={results[0]} onApprove={onApprove} />;
  }

  // Multiple results: render side-by-side comparison view
  return <ComparisonView results={results} onApprove={onApprove} />;
}
