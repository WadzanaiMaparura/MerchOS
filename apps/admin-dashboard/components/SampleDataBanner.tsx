'use client';

/**
 * SampleDataBanner — persistent notice shown while the admin dashboard is in
 * demo mode (NEXT_PUBLIC_ADMIN_DEMO_MODE !== 'false'). Makes it unmistakable
 * that the figures on screen are illustrative sample data, not a live tenant's
 * real operational state. Renders nothing when demo mode is off.
 *
 * Wipe-clean: when the backend is connected and demo mode is disabled, this
 * component returns null and disappears automatically.
 */

import React from 'react';
import { isDemoMode } from '../lib/demo-data';

export function SampleDataBanner() {
  if (!isDemoMode()) return null;

  return (
    <div
      role="status"
      className="flex items-center gap-2 border-b border-amber-200 bg-amber-50 px-4 py-2 text-xs font-medium text-amber-800"
    >
      <svg
        className="h-4 w-4 shrink-0"
        fill="none"
        viewBox="0 0 24 24"
        stroke="currentColor"
        strokeWidth={2}
        aria-hidden="true"
      >
        <path
          strokeLinecap="round"
          strokeLinejoin="round"
          d="M12 9v3.75m0 3.75h.008M10.29 3.86 1.82 18a1.75 1.75 0 0 0 1.5 2.62h17.36a1.75 1.75 0 0 0 1.5-2.62L13.71 3.86a1.75 1.75 0 0 0-3.42 0Z"
        />
      </svg>
      <span>
        Sample data — not live. Figures shown are illustrative and will be
        replaced by real data once the backend is connected.
      </span>
    </div>
  );
}

export default SampleDataBanner;
