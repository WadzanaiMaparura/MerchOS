'use client';

import React from 'react';
import * as Progress from '@radix-ui/react-progress';

export interface ProgressBarProps {
  /** Current value (0-100 or raw value if max is provided) */
  value: number;
  /** Maximum value. Defaults to 100. */
  max?: number;
  /** Accessible label describing what is being measured */
  label: string;
  /** Whether to show the percentage/value text */
  showValue?: boolean;
  /** Size variant */
  size?: 'sm' | 'md' | 'lg';
  /** Color variant based on threshold (auto-calculated or manual) */
  variant?: 'default' | 'success' | 'warning' | 'danger';
}

const SIZE_CLASSES = {
  sm: 'h-1.5',
  md: 'h-2.5',
  lg: 'h-4',
} as const;

const INDICATOR_COLORS = {
  default: 'bg-blue-600',
  success: 'bg-green-600',
  warning: 'bg-yellow-500',
  danger: 'bg-red-600',
} as const;

/**
 * ProgressBar - Accessible progress indicator built on Radix Progress.
 * Used for usage meters and export progress.
 * Provides aria-valuenow, aria-valuemin, aria-valuemax for screen readers.
 */
export function ProgressBar({
  value,
  max = 100,
  label,
  showValue = true,
  size = 'md',
  variant = 'default',
}: ProgressBarProps) {
  const percentage = Math.min(Math.round((value / max) * 100), 100);

  // Auto-determine variant based on percentage if default
  const resolvedVariant =
    variant === 'default'
      ? percentage >= 90
        ? 'danger'
        : percentage >= 75
        ? 'warning'
        : 'default'
      : variant;

  return (
    <div className="flex flex-col gap-1.5">
      <div className="flex items-center justify-between">
        <span className="text-sm font-medium text-gray-700">{label}</span>
        {showValue && (
          <span className="text-sm text-gray-500">
            {value} / {max} ({percentage}%)
          </span>
        )}
      </div>
      <Progress.Root
        value={value}
        max={max}
        className={`relative w-full overflow-hidden rounded-full bg-gray-200 ${SIZE_CLASSES[size]}`}
        aria-label={label}
      >
        <Progress.Indicator
          className={`h-full rounded-full transition-all duration-300 ease-in-out ${INDICATOR_COLORS[resolvedVariant]}`}
          style={{ width: `${percentage}%` }}
        />
      </Progress.Root>
    </div>
  );
}
