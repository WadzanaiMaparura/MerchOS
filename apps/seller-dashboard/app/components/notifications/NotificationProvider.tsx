'use client';

import React, { useCallback, useEffect, useRef } from 'react';
import { useToast } from '@merch-os/ui';
import { ENGAGEMENT_API_URL, fetchNotifications, type SellerNotification } from '../engagement/engagement-api';
import { useNotificationStore } from '../../stores/notification-store';

/** How often the bell checks for new notifications while the tab is open. */
export const NOTIFICATION_POLL_MS = 60_000;

interface NotificationProviderProps {
  children: React.ReactNode;
  /** Start checking once the seller is signed in. */
  enabled: boolean;
}

/**
 * Keeps the bell up to date by asking the engagement API every minute while
 * the tab is visible, and straight away when the seller comes back to the tab.
 * Nothing is checked while the tab is hidden.
 *
 * Something new since the last check: a toast (8 seconds) and a screen reader
 * announcement. The first load after sign-in shows the count only, no toasts.
 */
export function NotificationProvider({ children, enabled }: NotificationProviderProps) {
  const { toast } = useToast();
  const setFromServer = useNotificationStore((s) => s.setFromServer);
  const liveRegionRef = useRef<HTMLDivElement>(null);
  const seen = useRef<Set<string> | null>(null);
  const inFlight = useRef(false);

  const announce = useCallback(
    (fresh: SellerNotification[]) => {
      for (const n of fresh.slice(0, 3)) {
        toast({ title: n.title, description: n.message.slice(0, 200), variant: 'info', duration: 8000 });
      }
      if (liveRegionRef.current) {
        const first = fresh[0]!;
        liveRegionRef.current.textContent =
          fresh.length === 1
            ? `New notification: ${first.title}. ${first.message.slice(0, 200)}`
            : `${fresh.length} new notifications. Latest: ${first.title}.`;
      }
    },
    [toast],
  );

  const refresh = useCallback(async () => {
    if (inFlight.current) return;
    inFlight.current = true;
    try {
      const { notifications, unreadCount } = await fetchNotifications();
      const previous = seen.current;
      const fresh = previous ? notifications.filter((n) => !n.read && !previous.has(n.id)) : [];
      seen.current = new Set([...(previous ?? []), ...notifications.map((n) => n.id)]);
      setFromServer(notifications, unreadCount);
      if (fresh.length) announce(fresh);
    } catch {
      // Offline, signed out or the API is unavailable: the next check catches up.
    } finally {
      inFlight.current = false;
    }
  }, [announce, setFromServer]);

  useEffect(() => {
    if (!enabled || !ENGAGEMENT_API_URL) return;
    const visible = () => document.visibilityState === 'visible';
    void refresh();
    const timer = window.setInterval(() => {
      if (visible()) void refresh();
    }, NOTIFICATION_POLL_MS);
    const onVisible = () => {
      if (visible()) void refresh();
    };
    document.addEventListener('visibilitychange', onVisible);
    return () => {
      window.clearInterval(timer);
      document.removeEventListener('visibilitychange', onVisible);
    };
  }, [enabled, refresh]);

  return (
    <>
      {children}
      <div ref={liveRegionRef} aria-live="polite" aria-atomic="true" className="sr-only" role="status" />
    </>
  );
}
