'use client';

import React, { useCallback, useEffect, useRef } from 'react';
import { useToast } from '@merch-os/ui';
import { WebSocketManager } from '@merch-os/api-client';
import type { Notification } from '@merch-os/types';
import { useNotificationStore } from '../../stores/notification-store';

interface NotificationProviderProps {
  children: React.ReactNode;
  /** WebSocket URL for real-time notifications. */
  wsUrl: string;
  /** Function to retrieve current access token for authentication. */
  getAccessToken: () => Promise<string>;
}

/**
 * NotificationProvider - Manages WebSocket connection lifecycle and bridges
 * real-time notifications to the Zustand store and Toast system.
 *
 * Responsibilities:
 * - Initializes WebSocket connection with authentication
 * - Handles incoming notifications and adds them to the store
 * - Displays toast notifications within 3 seconds of event, visible for 8 seconds
 * - Manages connection status updates (connected, reconnecting, polling, disconnected)
 * - Provides ARIA live region for screen reader announcements (aria-live="polite")
 * - On reconnection, missed notifications are automatically retrieved by WebSocketManager
 *
 * WebSocket Configuration:
 * - Max 5 reconnection attempts
 * - Exponential backoff: 1s, 2s, 4s, 8s, 16s (capped at 30s)
 * - Fallback to polling at 30-second intervals after max attempts exhausted
 *
 * Validates: Requirements 12.1, 12.2, 12.3, 12.4, 12.5, 12.6, 14.4
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
      // Add to store (maintains max 50, deduplicates)
      addNotification(notification);

      // Display toast notification (visible for 8 seconds per requirement 12.1)
      toast({
        title: notification.title,
        description: notification.message.slice(0, 200),
        variant: 'info',
        duration: 8000,
      });

      // Announce to screen readers via ARIA live region (requirement 14.4)
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
        // Use manager's detailed status for non-connected states
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
