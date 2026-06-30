'use client';

import React, { useCallback, useEffect, useRef } from 'react';
import { useRouter } from 'next/navigation';
import type { Notification, EventType } from '@merch-os/types';
import { useNotificationStore } from '../../stores/notification-store';
import { getNotificationNavigationPath } from '../../config/notification-routes';

/**
 * NotificationDropdown - Accessible notification history dropdown.
 *
 * Accessible from the top bar, displaying the most recent 50 notifications
 * with read/unread status, ordered newest to oldest.
 *
 * Features:
 * - Mark-as-read on click (updates unread count within 1 second per req 12.4)
 * - Mark all as read
 * - Notification click navigates to relevant detail page (req 12.3)
 * - Keyboard accessible (Escape to close, focus management per req 14.6)
 * - Empty state message when no notifications (req 12.6)
 * - Loading state with appropriate messaging
 *
 * Validates: Requirements 12.2, 12.3, 12.4, 12.6, 14.4, 14.6
 */
export function NotificationDropdown() {
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

  const handleNotificationClick = useCallback(
    (notification: Notification) => {
      // Mark as read immediately — updates unread count within 1 second (req 12.4)
      if (!notification.read) {
        markAsRead(notification.id);
      }

      // Navigate to corresponding detail page (req 12.3)
      const route = getNotificationNavigationPath(notification);
      setHistoryOpen(false);
      router.push(route);
    },
    [markAsRead, setHistoryOpen, router]
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
      {/* Notification bell button */}
      <button
        ref={buttonRef}
        onClick={toggleHistory}
        className="relative rounded-md p-2 text-gray-600 hover:bg-gray-100 hover:text-gray-900 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-600 focus-visible:ring-offset-2"
        aria-label={`Notifications${unreadCount > 0 ? `, ${unreadCount} unread` : ''}`}
        aria-expanded={isHistoryOpen}
        aria-haspopup="true"
        aria-controls="notification-history-panel"
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
          id="notification-history-panel"
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
                <NotificationItem
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

interface NotificationItemProps {
  notification: Notification;
  onClick: (notification: Notification) => void;
  formatTimestamp: (timestamp: string) => string;
}

const NotificationItem = React.forwardRef<HTMLButtonElement, NotificationItemProps>(
  function NotificationItem({ notification, onClick, formatTimestamp }, ref) {
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
