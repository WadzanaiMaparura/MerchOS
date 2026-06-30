'use client';

import { useEffect, useRef } from 'react';
import { useErrorStore } from '../stores/error-store';

/**
 * Hook that monitors browser online/offline status using navigator.onLine
 * and the window 'online'/'offline' events. Updates the global error store
 * to show/hide the offline indicator.
 *
 * Per requirements: offline indicator removed within 5 seconds of reconnection.
 */
export function useOfflineDetection(): void {
  const setOffline = useErrorStore((state) => state.setOffline);
  const reconnectionTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    // Initialize with current browser state
    if (typeof navigator !== 'undefined' && !navigator.onLine) {
      setOffline(true);
    }

    const handleOffline = () => {
      // Clear any pending reconnection timer
      if (reconnectionTimerRef.current) {
        clearTimeout(reconnectionTimerRef.current);
        reconnectionTimerRef.current = null;
      }
      setOffline(true);
    };

    const handleOnline = () => {
      // Remove offline indicator within 5 seconds of reconnection
      // We update immediately but allow the UI to show a brief "reconnected" state
      reconnectionTimerRef.current = setTimeout(() => {
        setOffline(false);
        reconnectionTimerRef.current = null;
      }, 2000); // Remove within 5 seconds — using 2s for responsiveness while staying within spec
    };

    window.addEventListener('offline', handleOffline);
    window.addEventListener('online', handleOnline);

    return () => {
      window.removeEventListener('offline', handleOffline);
      window.removeEventListener('online', handleOnline);
      if (reconnectionTimerRef.current) {
        clearTimeout(reconnectionTimerRef.current);
      }
    };
  }, [setOffline]);
}
