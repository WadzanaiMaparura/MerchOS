'use client';

import React from 'react';
import { useNotificationStore } from '../../stores/notification-store';

/**
 * ConnectionStatusIndicator - Displays the real-time connection status in the top bar.
 *
 * Shows a colored dot and label when the connection is not in the ideal "connected" state.
 * Hidden when connected (no indicator needed in normal state).
 */
export function ConnectionStatusIndicator() {
  const connectionStatus = useNotificationStore((state) => state.connectionStatus);

  // Don't show anything when connected - that's the normal state
  if (connectionStatus === 'connected') return null;

  const statusConfig = {
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
  } as const;

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
