'use client';

import React from 'react';

export interface CardProps {
  /** Card content */
  children: React.ReactNode;
  /** Optional title displayed at the top */
  title?: string;
  /** Additional CSS classes */
  className?: string;
  /** Optional padding override */
  padding?: 'none' | 'sm' | 'md' | 'lg';
}

const PADDING_MAP = {
  none: '',
  sm: 'p-3',
  md: 'p-4',
  lg: 'p-6',
};

/**
 * Card - A generic container component for grouping related content.
 * Provides a consistent bordered surface with optional title.
 */
export function Card({ children, title, className = '', padding = 'md' }: CardProps) {
  return (
    <div
      className={`rounded-lg border border-gray-200 bg-white shadow-sm ${PADDING_MAP[padding]} ${className}`}
    >
      {title && (
        <h3 className="mb-3 text-sm font-semibold text-gray-900">{title}</h3>
      )}
      {children}
    </div>
  );
}

// --- StatCard ---

export interface StatCardProps {
  /** Label for the metric */
  label: string;
  /** Numeric or string value to display */
  value: string | number;
  /** Optional description or trend text */
  description?: string;
  /** Optional icon element */
  icon?: React.ReactNode;
  /** Trend direction for visual indicator */
  trend?: 'up' | 'down' | 'neutral';
  /** Additional CSS classes */
  className?: string;
}

/**
 * StatCard - Dashboard metric card displaying a key stat with label, value, and optional trend.
 * Used in dashboard views to display summary metrics at a glance.
 */
export function StatCard({
  label,
  value,
  description,
  icon,
  trend,
  className = '',
}: StatCardProps) {
  return (
    <div
      className={`rounded-lg border border-gray-200 bg-white p-4 shadow-sm ${className}`}
      role="group"
      aria-label={`${label}: ${value}`}
    >
      <div className="flex items-start justify-between">
        <div className="flex-1">
          <p className="text-sm font-medium text-gray-500">{label}</p>
          <p className="mt-1 text-2xl font-bold text-gray-900">{value}</p>
          {description && (
            <p className="mt-1 flex items-center gap-1 text-xs text-gray-500">
              {trend && <TrendIndicator trend={trend} />}
              {description}
            </p>
          )}
        </div>
        {icon && (
          <div className="flex-shrink-0 rounded-md bg-gray-50 p-2 text-gray-600" aria-hidden="true">
            {icon}
          </div>
        )}
      </div>
    </div>
  );
}

function TrendIndicator({ trend }: { trend: 'up' | 'down' | 'neutral' }) {
  if (trend === 'up') {
    return (
      <svg xmlns="http://www.w3.org/2000/svg" className="h-3 w-3 text-green-600" fill="none" viewBox="0 0 24 24" stroke="currentColor" aria-hidden="true">
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 15l7-7 7 7" />
      </svg>
    );
  }
  if (trend === 'down') {
    return (
      <svg xmlns="http://www.w3.org/2000/svg" className="h-3 w-3 text-red-600" fill="none" viewBox="0 0 24 24" stroke="currentColor" aria-hidden="true">
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
      </svg>
    );
  }
  return (
    <svg xmlns="http://www.w3.org/2000/svg" className="h-3 w-3 text-gray-400" fill="none" viewBox="0 0 24 24" stroke="currentColor" aria-hidden="true">
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 12h14" />
    </svg>
  );
}
