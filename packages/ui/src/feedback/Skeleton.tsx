'use client';

import React from 'react';

export interface SkeletonProps {
  /** Width of the skeleton placeholder */
  width?: string | number;
  /** Height of the skeleton placeholder */
  height?: string | number;
  /** Additional CSS classes */
  className?: string;
  /** Whether to render as a circle */
  circle?: boolean;
}

/**
 * Skeleton - Animated loading placeholder with pulse animation.
 * Provides a visual indication that content is loading.
 */
export function Skeleton({ width, height, className = '', circle = false }: SkeletonProps) {
  const style: React.CSSProperties = {};
  if (width) style.width = typeof width === 'number' ? `${width}px` : width;
  if (height) style.height = typeof height === 'number' ? `${height}px` : height;

  return (
    <div
      role="status"
      aria-label="Loading"
      className={`animate-pulse bg-gray-200 ${circle ? 'rounded-full' : 'rounded-md'} ${className}`}
      style={style}
    />
  );
}
