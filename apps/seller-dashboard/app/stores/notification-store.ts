'use client';

import { create } from 'zustand';
import type { Notification } from '@merch-os/types';

/** Maximum number of notifications retained in history. */
const MAX_NOTIFICATIONS = 50;

export type ConnectionStatus = 'connected' | 'reconnecting' | 'polling' | 'disconnected';

interface NotificationStore {
  /** Most recent 50 notifications, ordered newest first. */
  notifications: Notification[];
  /** Number of unread notifications. */
  unreadCount: number;
  /** WebSocket connection status. */
  connectionStatus: ConnectionStatus;
  /** Whether the notification history dropdown is open. */
  isHistoryOpen: boolean;

  /** Add a new notification (maintains max 50, newest first). */
  addNotification: (notification: Notification) => void;
  /** Mark a single notification as read by ID. */
  markAsRead: (id: string) => void;
  /** Mark all notifications as read. */
  markAllAsRead: () => void;
  /** Update the connection status. */
  setConnectionStatus: (status: ConnectionStatus) => void;
  /** Toggle the notification history dropdown. */
  toggleHistory: () => void;
  /** Set the notification history dropdown open/closed state. */
  setHistoryOpen: (open: boolean) => void;
}

export const useNotificationStore = create<NotificationStore>((set) => ({
  notifications: [],
  unreadCount: 0,
  connectionStatus: 'disconnected',
  isHistoryOpen: false,

  addNotification: (notification) =>
    set((state) => {
      // Avoid duplicates
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
