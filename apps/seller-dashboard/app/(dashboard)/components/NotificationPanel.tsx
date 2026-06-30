'use client';

import React, { useCallback, useEffect, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { useToast } from '@merch-os/ui';
import { WebSocketManager } from '@merch-os/api-client';
import type { Notification } from '@merch-os/types';
import { useNotificationStore } from '../../stores/notification-store';
import type { ConnectionStatus } from '../../stores/notification-store';

// ─── Notification Toast Bridge ────────────────────────────────────────────────

interface NotificationToastBridgeProps {
  children: React.ReactNode;
  /** WebSocket URL for real-time notifications. */
  wsUrl: string;
  /** Function to retrieve current access token for authentication. */
  getAccessToken: () => Promise<string>;
}

/**
 * NotificationToastBridge - Manages WebSocket connection lifecycle and bridges
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
 * - Max 5 reconnection attempts with exponential backoff (1s, 2s, 4s, 8s, 16s capped at 30s)
 * - Fallback to polling at 30-second intervals after max attempts exhausted
 *
 * Validates: Requirements 12.1, 12.2, 12.5, 12.6, 14.4
 */
export function NotificationToastBridge({
  children,
  wsUrl,
  getAccessToken,
}: NotificationToastBridgeProps) {
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

// ─── Connection Status Indicator ──────────────────────────────────────────────

/**
 * ConnectionStatus - Displays the real-time connection status in the top bar.
 *
 * Shows a colored dot and label when the connection is not in the ideal "connected" state.
 * Hidden when connected (no indicator needed in normal state).
 *
 * Validates: Requirements 12.5
 */
export function NotificationConnectionStatus() {
  const connectionStatus = useNotificationStore((state) => state.connectionStatus);

  if (connectionStatus === 'connected') return null;

  const statusConfig: Record<Exclude<ConnectionStatus, 'connected'>, { label: string; dotColor: string; textColor: string; animate: boolean }> = {
    reconnecting: {
      label: 'Reconnecting...',
      dotColor: 'bg-yellow-500',
      textColor: 'text-yellow-700',
      animate: true,
    },
    polling: {
      label: 'Limited connectivity',
      dotColor: 'bg-orange-500',
      textColor: 'text-orange-700',
      animate: false,
    },
    disconnected: {
      label: 'Disconnected',
      dotColor: 'bg-red-500',
      textColor: 'text-red-700',
      animate: false,
    },
  };

  const config = statusConfig[connectionStatus];

  return (
    <div
      className={`flex items-center gap-1.5 rounded-md px-2 py-1 text-xs font-medium ${config.textColor}`}
      role="status"
      aria-live="polite"
      aria-label={`Connection status: ${config.label}`}
    >
      <span
        className={`inline-block h-2 w-2 rounded-full ${config.dotColor} ${config.animate ? 'animate-pulse' : ''}`}
        aria-hidden="true"
      />
      <span>{config.label}</span>
    </div>
  );
}

// ─── Notification Panel (History Dropdown) ────────────────────────────────────

/**
 * NotificationPanel - Accessible notification history dropdown accessible from the top bar.
 *
 * Displays the most recent 50 notifications with read/unread status, ordered newest first.
 * Features:
 * - Mark-as-read on click (updates unread count within 1 second per requirement 12.4)
 * - Mark all as read
 * - Keyboard accessible (Escape to close, focus management per requirement 14.6)
 * - Empty state message when no notifications (requirement 12.6)
 * - Loading state support
 *
 * Validates: Requirements 12.2, 12.3, 12.4, 12.6, 14.4, 14.6
 */
export function NotificationPanel() {
  const router = useRouter();
  const {
    notifications,
    unreadCount,
    isHistoryOpen,
    toggleHistory,
    setHistoryOpen,
    markAsRead,
    markAllAsRead,
  } = useNotificationStore();

  const dropdownRef = useRef<HTMLDivElement>(null);
  const buttonRef = useRef<HTMLButtonElement>(null);
  const firstItemRef = useRef<HTMLButtonElement>(null);

  // Focus first item when dropdown opens (requirement 14.6)
  useEffect(() => {
    if (isHistoryOpen && firstItemRef.current) {
      firstItemRef.current.focus();
    }
  }, [isHistoryOpen]);

  // Close on Escape key and return focus to trigger (requirement 14.6)
  useEffect(() => {
    if (!isHistoryOpen) return;

    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        setHistoryOpen(false);
        buttonRef.current?.focus();
      }
    };

    document.addEventListener('keydown', handleKeyDown);
    return () => document.removeEventListener('keydown', handleKeyDown);
  }, [isHistoryOpen, setHistoryOpen]);

  // Close on click outside
  useEffect(() => {
    if (!isHistoryOpen) return;

    const handleClickOutside = (e: MouseEvent) => {
      if (
        dropdownRef.current &&
        !dropdownRef.current.contains(e.target as Node) &&
        buttonRef.current &&
        !buttonRef.current.contains(e.target as Node)
      ) {
        setHistoryOpen(false);
      }
    };

    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, [isHistoryOpen, setHistoryOpen]);

  /**
   * Determine the navigation path for a notification based on its event type.
   * Requirement 12.3: product detail for product lifecycle events, inventory for
   * inventory changes, billing for billing events, channels for channel sync events.
   */
  const getNotificationRoute = useCallback(
    (notification: Notification): string | null => {
      const eventType = notification.type as string;

      if (
        eventType.startsWith('product.') ||
        eventType.startsWith('compliance.') ||
        eventType.startsWith('listing.') ||
        eventType.startsWith('ingestion.') ||
        eventType.startsWith('image.')
      ) {
        return notification.resourceId
          ? `/products/${notification.resourceId}`
          : '/products';
      }

      if (eventType.startsWith('inventory.')) {
        return '/inventory';
      }

      if (eventType.startsWith('billing.') || eventType.startsWith('subscription.')) {
        return '/billing';
      }

      if (eventType.startsWith('channel.') || eventType.startsWith('sync.')) {
        return '/settings/channels';
      }

      return null;
    },
    []
  );

  const handleNotificationClick = useCallback(
    (notification: Notification) => {
      if (!notification.read) {
        // Mark as read immediately — updates unread count within 1 second (req 12.4)
        markAsRead(notification.id);
      }

      // Navigate to corresponding detail page (req 12.3)
      const route = getNotificationRoute(notification);
      if (route) {
        setHistoryOpen(false);
        router.push(route);
      }
    },
    [markAsRead, getNotificationRoute, setHistoryOpen, router]
  );

  const formatTimestamp = (timestamp: string): string => {
    try {
      const date = new Date(timestamp);
      const now = new Date();
      const diffMs = now.getTime() - date.getTime();
      const diffMins = Math.floor(diffMs / 60000);
      const diffHours = Math.floor(diffMs / 3600000);
      const diffDays = Math.floor(diffMs / 86400000);

      if (diffMins < 1) return 'Just now';
      if (diffMins < 60) return `${diffMins}m ago`;
      if (diffHours < 24) return `${diffHours}h ago`;
      if (diffDays < 7) return `${diffDays}d ago`;
      return date.toLocaleDateString();
    } catch {
      return '';
    }
  };

  return (
    <div className="relative" ref={dropdownRef}>
      {/* Notification bell button with unread badge */}
      <button
        ref={buttonRef}
        onClick={toggleHistory}
        className="relative rounded-md p-2 text-gray-600 hover:bg-gray-100 hover:text-gray-900 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-600 focus-visible:ring-offset-2"
        aria-label={`Notifications${unreadCount > 0 ? `, ${unreadCount} unread` : ''}`}
        aria-expanded={isHistoryOpen}
        aria-haspopup="true"
        aria-controls="notification-panel"
      >
        {/* Bell icon */}
        <svg
          xmlns="http://www.w3.org/2000/svg"
          className="h-5 w-5"
          fill="none"
          viewBox="0 0 24 24"
          stroke="currentColor"
          aria-hidden="true"
        >
          <path
            strokeLinecap="round"
            strokeLinejoin="round"
            strokeWidth={2}
            d="M15 17h5l-1.405-1.405A2.032 2.032 0 0118 14.158V11a6.002 6.002 0 00-4-5.659V5a2 2 0 10-4 0v.341C7.67 6.165 6 8.388 6 11v3.159c0 .538-.214 1.055-.595 1.436L4 17h5m6 0v1a3 3 0 11-6 0v-1m6 0H9"
          />
        </svg>
        {/* Unread count badge */}
        {unreadCount > 0 && (
          <span
            className="absolute -right-0.5 -top-0.5 flex h-5 w-5 items-center justify-center rounded-full bg-red-500 text-xs font-bold text-white"
            aria-hidden="true"
          >
            {unreadCount > 99 ? '99+' : unreadCount}
          </span>
        )}
      </button>

      {/* Dropdown panel */}
      {isHistoryOpen && (
        <div
          id="notification-panel"
          role="region"
          aria-label="Notification history"
          className="absolute right-0 top-full z-50 mt-2 w-96 max-w-[calc(100vw-2rem)] rounded-lg border border-gray-200 bg-white shadow-lg"
        >
          {/* Header */}
          <div className="flex items-center justify-between border-b border-gray-200 px-4 py-3">
            <h2 className="text-sm font-semibold text-gray-900">Notifications</h2>
            {unreadCount > 0 && (
              <button
                onClick={markAllAsRead}
                className="text-xs font-medium text-blue-600 hover:text-blue-800 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-600 focus-visible:ring-offset-2"
              >
                Mark all as read
              </button>
            )}
          </div>

          {/* Notification list */}
          <div
            className="max-h-96 overflow-y-auto"
            role="list"
            aria-label="Recent notifications"
          >
            {notifications.length === 0 ? (
              <div className="px-4 py-8 text-center text-sm text-gray-500">
                No notifications available
              </div>
            ) : (
              notifications.map((notification, index) => (
                <NotificationPanelItem
                  key={notification.id}
                  ref={index === 0 ? firstItemRef : undefined}
                  notification={notification}
                  onClick={handleNotificationClick}
                  formatTimestamp={formatTimestamp}
                />
              ))
            )}
          </div>
        </div>
      )}
    </div>
  );
}

// ─── Notification Panel Item ──────────────────────────────────────────────────

interface NotificationPanelItemProps {
  notification: Notification;
  onClick: (notification: Notification) => void;
  formatTimestamp: (timestamp: string) => string;
}

const NotificationPanelItem = React.forwardRef<HTMLButtonElement, NotificationPanelItemProps>(
  function NotificationPanelItem({ notification, onClick, formatTimestamp }, ref) {
    return (
      <button
        ref={ref}
        role="listitem"
        onClick={() => onClick(notification)}
        className={`flex w-full items-start gap-3 border-b border-gray-100 px-4 py-3 text-left transition-colors hover:bg-gray-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-blue-600 ${
          !notification.read ? 'bg-blue-50' : ''
        }`}
        aria-label={`${notification.read ? '' : 'Unread: '}${notification.title}. ${notification.message}. ${formatTimestamp(notification.timestamp)}`}
      >
        {/* Unread indicator dot */}
        <div className="mt-1.5 flex-shrink-0">
          {!notification.read ? (
            <span className="block h-2 w-2 rounded-full bg-blue-600" aria-hidden="true" />
          ) : (
            <span className="block h-2 w-2" aria-hidden="true" />
          )}
        </div>

        {/* Content */}
        <div className="min-w-0 flex-1">
          <p className="truncate text-sm font-medium text-gray-900">
            {notification.title}
          </p>
          <p className="mt-0.5 line-clamp-2 text-xs text-gray-600">
            {notification.message}
          </p>
          <p className="mt-1 text-xs text-gray-400">
            {formatTimestamp(notification.timestamp)}
          </p>
        </div>
      </button>
    );
  }
);

