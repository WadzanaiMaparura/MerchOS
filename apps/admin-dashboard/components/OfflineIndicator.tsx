'use client';

/**
 * OfflineIndicator — Persistent banner displayed when network connectivity is lost.
 *
 * Behavior:
 * - Listens to the browser's online/offline events.
 * - Shows a banner while offline.
 * - Removes the banner within 5 seconds of detecting reconnection.
 * - Uses aria-live="polite" to announce connectivity changes to screen readers.
 *
 * Requirements: 10.6
 */

import React, { useEffect, useState, useRef } from 'react';

export function OfflineIndicator() {
  const [isOffline, setIsOffline] = useState(false);
  const hideTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    // Initialise from current browser state
    setIsOffline(!navigator.onLine);

    const handleOffline = () => {
      // Cancel any pending hide timer when going offline again
      if (hideTimerRef.current) {
        clearTimeout(hideTimerRef.current);
        hideTimerRef.current = null;
      }
      setIsOffline(true);
    };

    const handleOnline = () => {
      // Remove banner within 5 seconds of reconnection (Requirement 10.6)
      hideTimerRef.current = setTimeout(() => {
        setIsOffline(false);
        hideTimerRef.current = null;
      }, 5_000);
    };

    window.addEventListener('offline', handleOffline);
    window.addEventListener('online', handleOnline);

    return () => {
      window.removeEventListener('offline', handleOffline);
      window.removeEventListener('online', handleOnline);
      if (hideTimerRef.current) {
        clearTimeout(hideTimerRef.current);
      }
    };
  }, []);

  if (!isOffline) return null;

  return (
    <div
      role="status"
      aria-live="polite"
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
