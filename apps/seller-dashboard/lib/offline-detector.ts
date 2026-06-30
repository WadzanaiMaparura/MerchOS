'use client';

import { useEffect, useRef, useCallback } from 'react';
import { useErrorStore } from '../app/stores/error-store';

/**
 * Offline detector utility and hook.
 *
 * Monitors navigator.onLine and window 'online'/'offline' events to detect
 * network connectivity changes. Updates the global error store to control
 * the persistent offline indicator in the top bar.
 *
 * Per Requirement 13.5:
 * - WHILE the application detects no network connectivity, display a persistent
 *   offline indicator in the top bar.
 * - WHEN network connectivity is restored, remove the offline indicator within
 *   5 seconds of detecting reconnection.
 */

/**
 * Check the current online status of the browser.
 * Returns false if navigator.onLine is false.
 */
export function isOnline(): boolean {
  if (typeof navigator === 'undefined') return true;
  return navigator.onLine;
}

/**
 * Subscribe to online/offline events. Returns an unsubscribe function.
 * @param onOffline - Callback when the browser goes offline
 * @param onOnline - Callback when the browser comes back online
 */
export function subscribeToConnectivity(
  onOffline: () => void,
  onOnline: () => void
): () => void {
  window.addEventListener('offline', onOffline);
  window.addEventListener('online', onOnline);

  return () => {
    window.removeEventListener('offline', onOffline);
    window.removeEventListener('online', onOnline);
  };
}

/**
 * React hook that monitors browser online/offline status.
 * Updates the global error store's isOffline flag.
 *
 * Behaviour:
 * - Immediately sets offline state when the 'offline' event fires
 * - Removes offline indicator within 5 seconds of the 'online' event
 *   (using a 2-second delay for responsiveness while remaining within spec)
 *
 * Usage:
 *   useOfflineDetector(); // Call in a layout or provider component
 */
export function useOfflineDetector(): void {
  const setOffline = useErrorStore((state) => state.setOffline);
  const reconnectionTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const handleOffline = useCallback(() => {
    // Clear any pending reconnection timer
    if (reconnectionTimerRef.current) {
      clearTimeout(reconnectionTimerRef.current);
      reconnectionTimerRef.current = null;
    }
    setOffline(true);
  }, [setOffline]);

  const handleOnline = useCallback(() => {
    // Remove offline indicator within 5 seconds of reconnection
    // Using 2s for responsiveness while staying well within the 5s spec
    reconnectionTimerRef.current = setTimeout(() => {
      setOffline(false);
      reconnectionTimerRef.current = null;
    }, 2000);
  }, [setOffline]);

  useEffect(() => {
    // Initialize with current browser connectivity state
    if (!isOnline()) {
      setOffline(true);
    }

    const unsubscribe = subscribeToConnectivity(handleOffline, handleOnline);

    return () => {
      unsubscribe();
      if (reconnectionTimerRef.current) {
        clearTimeout(reconnectionTimerRef.current);
      }
    };
  }, [setOffline, handleOffline, handleOnline]);
}

export default useOfflineDetector;
