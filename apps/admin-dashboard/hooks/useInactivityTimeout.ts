'use client';

/**
 * useInactivityTimeout — Fires a callback after a period of user inactivity.
 *
 * Listens to the specified DOM events on the window object to detect user
 * activity. If no activity is detected within `timeoutMs`, `onTimeout` is
 * called. The timer resets on every activity event.
 *
 * Default events: mousedown, keydown, scroll, touchstart
 *
 * Requirements: 1.9
 */

import { useEffect, useRef, useCallback } from 'react';

const DEFAULT_EVENTS: readonly string[] = [
  'mousedown',
  'keydown',
  'scroll',
  'touchstart',
] as const;

export interface InactivityTimeoutOptions {
  /** Inactivity threshold in milliseconds. Default: 1,800,000 (30 minutes). */
  timeoutMs?: number;
  /** Callback invoked when the inactivity threshold is exceeded. */
  onTimeout: () => void;
  /** DOM events that count as activity. Defaults to mousedown, keydown, scroll, touchstart. */
  events?: readonly string[];
}

/**
 * Hook that calls `onTimeout` after `timeoutMs` of inactivity.
 *
 * @example
 * useInactivityTimeout({
 *   timeoutMs: 30 * 60 * 1000,
 *   onTimeout: logout,
 * });
 */
export function useInactivityTimeout({
  timeoutMs = 1_800_000,
  onTimeout,
  events = DEFAULT_EVENTS,
}: InactivityTimeoutOptions): void {
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  // Keep a stable reference to onTimeout to avoid re-registering listeners
  const onTimeoutRef = useRef(onTimeout);

  useEffect(() => {
    onTimeoutRef.current = onTimeout;
  }, [onTimeout]);

  const resetTimer = useCallback(() => {
    if (timerRef.current !== null) {
      clearTimeout(timerRef.current);
    }
    timerRef.current = setTimeout(() => {
      onTimeoutRef.current();
    }, timeoutMs);
  }, [timeoutMs]);

  useEffect(() => {
    // Start the initial timer
    resetTimer();

    // Register activity listeners
    for (const event of events) {
      window.addEventListener(event, resetTimer, { passive: true });
    }

    return () => {
      // Clean up timer and listeners on unmount
      if (timerRef.current !== null) {
        clearTimeout(timerRef.current);
      }
      for (const event of events) {
        window.removeEventListener(event, resetTimer);
      }
    };
  }, [events, resetTimer]);
}
