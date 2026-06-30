'use client';

import React from 'react';
import { useErrorStore, ErrorNotification } from '../stores/error-store';

/**
 * Renders the global error notification toasts.
 * - Dismissible by clicking the close button
 * - Auto-dismissed after 8 seconds (handled by the store)
 * - Maximum 3 simultaneous (oldest dismissed first when exceeded)
 * - HTTP 403 errors display "access denied" without retry option
 * - Announces via aria-live="assertive" for screen reader accessibility
 *
 * Requirements: 2.7, 2.8, 13.2, 14.4
 */
export function ErrorNotificationContainer() {
  const notifications = useErrorStore((state) => state.notifications);
  const dismissError = useErrorStore((state) => state.dismissError);

  if (notifications.length === 0) {
    return null;
  }

  return (
    <div
      aria-live="assertive"
      aria-atomic="false"
      aria-relevant="additions removals"
      className="fixed bottom-4 right-4 z-50 flex w-full max-w-sm flex-col gap-2"
    >
      {notifications.map((notification) => (
        <ErrorNotificationToast
          key={notification.id}
          notification={notification}
          onDismiss={dismissError}
        />
      ))}
    </div>
  );
}

interface ErrorNotificationToastProps {
  notification: ErrorNotification;
  onDismiss: (id: string) => void;
}

function ErrorNotificationToast({ notification, onDismiss }: ErrorNotificationToastProps) {
  const getIcon = () => {
    switch (notification.type) {
      case 'access-denied':
        return (
          <svg
            xmlns="http://www.w3.org/2000/svg"
            className="h-5 w-5 text-red-500"
            fill="none"
            viewBox="0 0 24 24"
            stroke="currentColor"
            aria-hidden="true"
          >
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              strokeWidth={2}
              d="M18.364 18.364A9 9 0 005.636 5.636m12.728 12.728A9 9 0 015.636 5.636m12.728 12.728L5.636 5.636"
            />
          </svg>
        );
      case 'timeout':
        return (
          <svg
            xmlns="http://www.w3.org/2000/svg"
            className="h-5 w-5 text-orange-500"
            fill="none"
            viewBox="0 0 24 24"
            stroke="currentColor"
            aria-hidden="true"
          >
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              strokeWidth={2}
              d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z"
            />
          </svg>
        );
      case 'network':
        return (
          <svg
            xmlns="http://www.w3.org/2000/svg"
            className="h-5 w-5 text-yellow-500"
            fill="none"
            viewBox="0 0 24 24"
            stroke="currentColor"
            aria-hidden="true"
          >
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              strokeWidth={2}
              d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-2.5L13.732 4c-.77-.833-1.964-.833-2.732 0L4.082 16.5c-.77.833.192 2.5 1.732 2.5z"
            />
          </svg>
        );
      default:
        return (
          <svg
            xmlns="http://www.w3.org/2000/svg"
            className="h-5 w-5 text-red-500"
            fill="none"
            viewBox="0 0 24 24"
            stroke="currentColor"
            aria-hidden="true"
          >
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              strokeWidth={2}
              d="M10 14l2-2m0 0l2-2m-2 2l-2-2m2 2l2 2m7-2a9 9 0 11-18 0 9 9 0 0118 0z"
            />
          </svg>
        );
    }
  };

  const getBorderColor = () => {
    switch (notification.type) {
      case 'access-denied':
        return 'border-l-red-600';
      case 'timeout':
        return 'border-l-orange-500';
      case 'network':
        return 'border-l-yellow-500';
      default:
        return 'border-l-red-500';
    }
  };

  return (
    <div
      role="alert"
      aria-live="assertive"
      className={`animate-in slide-in-from-right-full rounded-lg border border-gray-200 border-l-4 ${getBorderColor()} bg-white p-4 shadow-lg`}
    >
      <div className="flex items-start gap-3">
        <div className="flex-shrink-0 pt-0.5">{getIcon()}</div>
        <div className="flex-1 min-w-0">
          <p className="text-sm font-semibold text-gray-900">{notification.title}</p>
          <p className="mt-1 text-sm text-gray-600">{notification.message}</p>
          {notification.type === 'access-denied' && (
            <p className="mt-1 text-xs text-gray-500 italic">
              This action is not permitted for your role.
            </p>
          )}
        </div>
        <button
          onClick={() => onDismiss(notification.id)}
          className="flex-shrink-0 rounded-sm p-1 text-gray-400 hover:text-gray-600 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-600 focus-visible:ring-offset-2"
          aria-label="Dismiss error notification"
        >
          <svg
            xmlns="http://www.w3.org/2000/svg"
            className="h-4 w-4"
            fill="none"
            viewBox="0 0 24 24"
            stroke="currentColor"
            aria-hidden="true"
          >
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              strokeWidth={2}
              d="M6 18L18 6M6 6l12 12"
            />
          </svg>
        </button>
      </div>
    </div>
  );
}
