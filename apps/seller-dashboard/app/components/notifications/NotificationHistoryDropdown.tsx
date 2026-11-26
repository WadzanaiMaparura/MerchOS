'use client';

import React, { useCallback, useEffect, useRef } from 'react';
import { useRouter } from 'next/navigation';
import { markNotificationsRead, type SellerNotification } from '../engagement/engagement-api';
import { useNotificationStore } from '../../stores/notification-store';

type Notification = SellerNotification;

/** Only paths inside the dashboard are followed (the server sends paths, never URLs). */
export function safeLink(link: string): string {
  return /^\/[A-Za-z0-9/_%.-]*$/.test(link) && !link.startsWith('//') ? link : '/dashboard';
}

/**
 * NotificationHistoryDropdown - the bell: the last 50 notifications, newest first.
 * Opening one marks it read (saved for the account) and goes to its page.
 */
export function NotificationHistoryDropdown() {
  const {
    notifications,
    unreadCount,
    isHistoryOpen,
    toggleHistory,
    setHistoryOpen,
    markAsReadLocal,
    markAllAsReadLocal,
    setFromServer,
  } = useNotificationStore();

  // Shown as read straight away; the saved state comes back from the server.
  const save = useCallback(
    (input: { ids: string[] } | { all: true }) => {
      markNotificationsRead(input)
        .then((r) => setFromServer(r.notifications, r.unreadCount))
        .catch(() => undefined);
    },
    [setFromServer],
  );
  const markAsRead = useCallback(
    (id: string) => {
      markAsReadLocal(id);
      save({ ids: [id] });
    },
    [markAsReadLocal, save],
  );
  const markAllAsRead = useCallback(() => {
    markAllAsReadLocal();
    save({ all: true });
  }, [markAllAsReadLocal, save]);

  const dropdownRef = useRef<HTMLDivElement>(null);
  const buttonRef = useRef<HTMLButtonElement>(null);

  // Close on Escape key
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

  const router = useRouter();

  const handleNotificationClick = useCallback(
    (notification: Notification) => {
      if (!notification.read) {
        markAsRead(notification.id);
      }
      setHistoryOpen(false);
      router.push(safeLink(notification.link));
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
      if (diffMins < 60) return `${diffMins} ${diffMins === 1 ? 'minute' : 'minutes'} ago`;
      if (diffHours < 24) return `${diffHours} ${diffHours === 1 ? 'hour' : 'hours'} ago`;
      if (diffDays === 1) return 'Yesterday';
      if (diffDays < 7) return `${diffDays} days ago`;
      return date.toLocaleDateString('en-ZA', { day: 'numeric', month: 'short', year: 'numeric' });
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
                Nothing new. Finished imports, payments and other updates show up here.
              </div>
            ) : (
              notifications.map((notification) => (
                <NotificationItem
                  key={notification.id}
                  notification={notification}
                  onClick={handleNotificationClick}
                  formatTimestamp={formatTimestamp}
                />
              ))
            )}
          </div>
          {notifications.length > 0 && (
            <p className="border-t border-gray-200 px-4 py-2 text-center text-xs text-gray-500">
              Showing the last 50. Kept for 90 days.
            </p>
          )}
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

function NotificationItem({ notification, onClick, formatTimestamp }: NotificationItemProps) {
  return (
    <button
      role="listitem"
      onClick={() => onClick(notification)}
      className={`flex w-full items-start gap-3 border-b border-gray-100 px-4 py-3 text-left transition-colors hover:bg-gray-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-blue-600 ${
        !notification.read ? 'bg-blue-50' : ''
      }`}
      aria-label={`${notification.read ? '' : 'Unread: '}${notification.title}. ${notification.message}. ${formatTimestamp(notification.at)}`}
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
          {formatTimestamp(notification.at)}
        </p>
      </div>
    </button>
  );
}
