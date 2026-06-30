'use client';

import React from 'react';
import { useErrorStore } from '../../stores/error-store';

/**
 * OfflineIndicator - Persistent banner displayed in the top bar when the
 * application detects no network connectivity.
 *
 * Behaviour:
 * - Shown when isOffline is true in the global error store
 * - Hidden (removed from DOM) when network is restored
 * - The offline-detector hook handles the 5-second removal delay after reconnection
 * - Uses aria-live="assertive" to announce connectivity changes to screen readers
 *
 * Requirement 13.5:
 * WHILE the application detects no network connectivity, THE App_Shell SHALL
 * display a persistent offline indicator in the top bar. WHEN network connectivity
 * is restored, THE App_Shell SHALL remove the offline indicator within 5 seconds
 * of detecting reconnection.
 */
export function OfflineIndicator() {
  const isOffline = useErrorStore((state) => state.isOffline);

  if (!isOffline) {
    return null;
  }

  return (
    <div
      role="status"
      aria-live="assertive"
      aria-atomic="true"
      className="flex items-center gap-2 rounded-md bg-yellow-100 px-3 py-1.5 text-sm font-medium text-yellow-800 border border-yellow-300"
    >
      <svg
        xmlns="http://www.w3.org/2000/svg"
        className="h-4 w-4 flex-shrink-0"
        fill="none"
        viewBox="0 0 24 24"
        stroke="currentColor"
        aria-hidden="true"
      >
        <path
          strokeLinecap="round"
          strokeLinejoin="round"
          strokeWidth={2}
          d="M18.364 5.636a9 9 0 010 12.728M5.636 5.636a9 9 0 000 12.728M12 12h.01"
        />
      </svg>
      <span>You are offline</span>
    </div>
  );
}

export default OfflineIndicator;
