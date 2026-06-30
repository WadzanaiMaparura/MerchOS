'use client';

import React from 'react';

export interface SkipNavProps {
  /** The id of the main content element to skip to */
  contentId?: string;
  /** Label for the skip link */
  label?: string;
}

/**
 * SkipNav - An accessible skip-to-content link that becomes visible on focus.
 * Allows keyboard users to bypass navigation and jump directly to main content.
 */
export function SkipNav({
  contentId = 'main-content',
  label = 'Skip to main content',
}: SkipNavProps) {
  return (
    <a
      href={`#${contentId}`}
      className="sr-only focus:not-sr-only focus:fixed focus:top-4 focus:left-4 focus:z-50 focus:px-4 focus:py-2 focus:bg-white focus:text-gray-900 focus:rounded-md focus:shadow-lg focus:ring-2 focus:ring-blue-600 focus:outline-none focus:text-sm focus:font-medium"
    >
      {label}
    </a>
  );
}
