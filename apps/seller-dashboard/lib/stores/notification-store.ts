'use client';

import { create } from 'zustand';
import type { Notification } from '@merch-os/types';

/**
 * Notification Store for Seller Dashboard
 *
 * Zustand store managing:
 * - notifications[] (max 50, newest first)
 * - unreadCount
 * - connectionStatus ('connected' | 'reconnecting' | 'polling' | 'disconnected')
 * - addNotification (deduplicates, caps at 50)
 * - markAsRead (updates unread count within 1 second)
 * - markAllAsRead
 * - setConnectionStatus
 *
 * Validates: Requirements 12.1, 12.2, 12.4, 12.5
 */

/** Maximum number of notifications retained in history. */
const MAX_NOTIFICATIONS = 50;

export type ConnectionStatus = 'connected' | 'reconnecting' | 'polling' | 'disconnected';

export interface NotificationStoreState {
  /** Most recent 50 notifications, ordered newest first. */
  notifications: Notification[];
  /** Number of unread notifications. */
  unreadCount: number;
  /** WebSocket connection status. */
  connectionStatus: ConnectionStatus;
  /** Whether the notification history dropdown is open. */
  isHistoryOpen: boolean;

  /** Add a new notification (maintains max 50, newest first, deduplicates). */
  addNotification: (notification: Notification) => void;
  /** Mark a single notification as read by ID — updates unread count within 1 second (req 12.4). */
  markAsRead: (id: string) => void;
  /** Mark all notifications as read. */
  markAllAsRead: () => void;
  /** Update the WebSocket connection status. */
  setConnectionStatus: (status: ConnectionStatus) => void;
  /** Toggle the notification history dropdown open/closed. */
  toggleHistory: () => void;
  /** Explicitly set the notification history dropdown state. */
  setHistoryOpen: (open: boolean) => void;
}

export const useNotificationStore = create<NotificationStoreState>((set) => ({
  notifications: [],
  unreadCount: 0,
  connectionStatus: 'disconnected',
  isHistoryOpen: false,

  addNotification: (notification) =>
    set((state) => {
      // Deduplicate: if notification already exists, skip
      if (state.notifications.some((n) => n.id === notification.id)) {
        return state;
      }

      // Add to front (newest first), cap at MAX_NOTIFICATIONS
      const updated = [notification, ...state.notifications].slice(0, MAX_NOTIFICATIONS);
      const unreadCount = updated.filter((n) => !n.read).length;

      return {
        notifications: updated,
        unreadCount,
      };
    }),

  markAsRead: (id) =>
    set((state) => {
      const notifications = state.notifications.map((n) =>
        n.id === id ? { ...n, read: true } : n
      );
      const unreadCount = notifications.filter((n) => !n.read).length;
      return { notifications, unreadCount };
    }),

  markAllAsRead: () =>
    set((state) => ({
      notifications: state.notifications.map((n) => ({ ...n, read: true })),
      unreadCount: 0,
    })),

  setConnectionStatus: (connectionStatus) => set({ connectionStatus }),

  toggleHistory: () => set((state) => ({ isHistoryOpen: !state.isHistoryOpen })),

  setHistoryOpen: (isHistoryOpen) => set({ isHistoryOpen }),
}));
