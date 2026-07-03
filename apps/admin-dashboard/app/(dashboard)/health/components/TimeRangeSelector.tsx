'use client';

import React from 'react';
import type { TimeRange } from '@merch-os/types';

// ─── Constants ────────────────────────────────────────────────────────────────

const TIME_RANGE_OPTIONS: { label: string; value: TimeRange }[] = [
  { label: '1h', value: '1h' },
  { label: '6h', value: '6h' },
  { label: '24h', value: '24h' },
  { label: '7d', value: '7d' },
];

// ─── Props ────────────────────────────────────────────────────────────────────

export interface TimeRangeSelectorProps {
  /** Currently selected time range */
  value: TimeRange;
  /** Callback fired when the operator selects a different time range */
  onChange: (range: TimeRange) => void;
  /** Whether the selector is disabled (e.g. during a data fetch) */
  disabled?: boolean;
}

// ─── Component ────────────────────────────────────────────────────────────────

/**
 * TimeRangeSelector – Toggle button group for selecting the metric time window.
 *
 * Requirements: 3.3
 */
export function TimeRangeSelector({
  value,
  onChange,
  disabled = false,
}: TimeRangeSelectorProps) {
  return (
    <div
      role="group"
      aria-label="Select time range"
      className="inline-flex rounded-md border border-gray-200 bg-gray-50 p-0.5"
    >
      {TIME_RANGE_OPTIONS.map(({ label, value: optionValue }, index) => {
        const isActive = value === optionValue;
        const isFirst = index === 0;
        const isLast = index === TIME_RANGE_OPTIONS.length - 1;

        return (
          <button
            key={optionValue}
            type="button"
            onClick={() => onChange(optionValue)}
            disabled={disabled}
            aria-pressed={isActive}
            aria-label={`Show last ${label}`}
            className={[
              'relative px-3 py-1.5 text-sm font-medium transition-colors',
              'focus-visible:z-10 focus-visible:outline-none focus-visible:ring-2',
              'focus-visible:ring-blue-600 focus-visible:ring-offset-1',
              isFirst ? 'rounded-l-md' : '',
              isLast ? 'rounded-r-md' : '',
              isActive
                ? 'bg-white text-blue-700 shadow-sm ring-1 ring-gray-200'
                : 'text-gray-600 hover:bg-white/60 hover:text-gray-900',
              disabled ? 'cursor-not-allowed opacity-50' : 'cursor-pointer',
            ]
              .filter(Boolean)
              .join(' ')}
          >
            {label}
          </button>
        );
      })}
    </div>
  );
}
