'use client';

import React from 'react';
import { ProgressBar } from '@merch-os/ui';
import type { ImportJobStatus } from '@merch-os/api-client';

// ─── Types ───────────────────────────────────────────────────────────────────

export interface ImportProgressProps {
  status: ImportJobStatus;
  progress?: {
    percentage: number;
    currentStep: string;
    estimatedTimeRemaining?: number;
  };
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

function formatStepLabel(step: string): string {
  const map: Record<string, string> = {
    PARSING: 'Parsing file…',
    EXTRACTING: 'Extracting products…',
    VALIDATING: 'Validating records…',
    DEDUPLICATING: 'Checking duplicates…',
    PERSISTING: 'Saving products…',
    CRAWLING: 'Crawling pages…',
    OCR: 'Processing images…',
  };
  return map[step] ?? step;
}

function formatTimeRemaining(ms: number): string {
  if (ms <= 0) return '';
  const seconds = Math.ceil(ms / 1000);
  if (seconds < 60) return `~${seconds}s remaining`;
  const minutes = Math.ceil(seconds / 60);
  return `~${minutes}m remaining`;
}

function getProgressVariant(status: ImportJobStatus): 'default' | 'success' | 'danger' {
  if (status === 'COMPLETED') return 'success';
  if (status === 'FAILED') return 'danger';
  return 'default';
}

// ─── Component ───────────────────────────────────────────────────────────────

/**
 * ImportProgress — Real-time progress indicator for an import job.
 *
 * Shows:
 * - Progress bar with percentage
 * - Current processing step
 * - Estimated time remaining
 *
 * The parent page polls the API every 3 seconds for in-progress jobs,
 * causing this component to re-render with updated progress data.
 *
 * Validates: Requirements 8.4
 */
export function ImportProgress({ status, progress }: ImportProgressProps) {
  const isTerminal = status === 'COMPLETED' || status === 'FAILED';
  const percentage = isTerminal
    ? status === 'COMPLETED'
      ? 100
      : progress?.percentage ?? 0
    : progress?.percentage ?? 0;

  const variant = getProgressVariant(status);

  return (
    <div className="flex flex-col gap-3 rounded-lg border border-gray-200 bg-white p-4">
      <div className="flex items-center justify-between">
        <h3 className="text-sm font-medium text-gray-900">Import Progress</h3>
        {!isTerminal && progress?.estimatedTimeRemaining != null && progress.estimatedTimeRemaining > 0 && (
          <span className="text-xs text-gray-500">
            {formatTimeRemaining(progress.estimatedTimeRemaining)}
          </span>
        )}
      </div>

      <ProgressBar
        value={percentage}
        max={100}
        label="Import progress"
        showValue={true}
        size="lg"
        variant={variant}
      />

      {/* Current step */}
      {!isTerminal && progress?.currentStep && (
        <p className="text-sm text-gray-600">
          {formatStepLabel(progress.currentStep)}
        </p>
      )}

      {/* Terminal state messages */}
      {status === 'COMPLETED' && (
        <p className="text-sm font-medium text-green-700">
          Import completed successfully
        </p>
      )}
      {status === 'FAILED' && (
        <p className="text-sm font-medium text-red-700">
          Import failed
        </p>
      )}

      {/* Queued state */}
      {status === 'QUEUED' && (
        <p className="text-sm text-gray-500">
          Waiting in queue…
        </p>
      )}
    </div>
  );
}
