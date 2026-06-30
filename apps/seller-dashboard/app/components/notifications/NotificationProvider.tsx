'use client';

import React, { useCallback, useEffect, useRef } from 'react';
import { useToast } from '@merch-os/ui';
import { WebSocketManager } from '@merch-os/api-client';
import type { Notification } from '@merch-os/types';
import { useNotificationStore } from '../../stores/notification-store';

interface NotificationProviderProps {
  children: React.ReactNode;
  /** WebSocket URL for notifications. */
  wsUrl: string;
  /** Function to retrieve current access token. */
  getAccessToken: () => Promise<string>;
}

/**
 * NotificationProvider - Manages WebSocket connection lifecycle and bridges
 * notifications to the Zustand store and Toast system.
 *
 * Displays notification toasts within 3 seconds of event arrival.
 * Toasts remain visible for 8 seconds or until dismissed.
 * Uses ARIA live region announcements for accessibility.
 */
export function NotificationProvider({
  children,
  wsUrl,
  getAccessToken,
}: NotificationProviderProps) {
  const { toast } = useToast();
  const { addNotification, setConnectionStatus } = useNotificationStore();
  const wsManagerRef = useRef<WebSocketManager | null>(null);
  const liveRegionRef = useRef<HTMLDivElement>(null);

  const handleMessage = useCallback(
    (notification: Notification) => {
      // Add to store
      addNotification(notification);

      // Display toast (visible for 8 seconds per requirement)
      toast({
        title: notification.title,
        description: notification.message.slice(0, 200),
        variant: 'info',
        duration: 8000,
      });

      // Announce to screen readers via ARIA live region
      if (liveRegionRef.current) {
        liveRegionRef.current.textContent = `New notification: ${notification.title}. ${notification.message.slice(0, 200)}`;
      }
    },
    [addNotification, toast]
  );

  const handleConnectionChange = useCallback(
    (connected: boolean) => {
      if (connected) {
        setConnectionStatus('connected');
      } else {
        // Determine if we're reconnecting or polling based on manager state
        const manager = wsManagerRef.current;
        if (manager) {
          setConnectionStatus(manager.getConnectionStatus());
        } else {
          setConnectionStatus('disconnected');
        }
      }
    },
    [setConnectionStatus]
  );

  useEffect(() => {
    const manager = new WebSocketManager({
      url: wsUrl,
      getAccessToken,
      onMessage: handleMessage,
      onConnectionChange: handleConnectionChange,
      maxReconnectAttempts: 5,
      maxBackoff: 30000,
      pollingInterval: 30000,
    });

    wsManagerRef.current = manager;
    manager.connect();

    return () => {
      manager.disconnect();
      wsManagerRef.current = null;
    };
  }, [wsUrl, getAccessToken, handleMessage, handleConnectionChange]);

  return (
    <>
      {children}
      {/* ARIA live region for screen reader announcements of new notifications */}
      <div
        ref={liveRegionRef}
        aria-live="polite"
        aria-atomic="true"
        className="sr-only"
        role="status"
      />
    </>
  );
}
