'use client';

import React from 'react';
import { OfflineIndicator } from './OfflineIndicator';

/**
 * TopBar - Application header/top bar containing user info,
 * notifications, and the offline indicator.
 *
 * The OfflineIndicator appears in this bar when network connectivity is lost.
 */
export function TopBar() {
  return (
    <header
      role="banner"
      className="sticky top-0 z-40 flex h-14 items-center justify-between border-b border-gray-200 bg-white px-4"
    >
      <div className="flex items-center gap-4">
        {/* Logo / Brand */}
        <span className="text-lg font-semibold text-gray-900">MerchOS</span>
      </div>

      <div className="flex items-center gap-3">
        {/* Offline indicator - shown when no network connectivity */}
        <OfflineIndicator />

        {/* Placeholder for notifications bell, user menu etc. */}
      </div>
    </header>
  );
}
