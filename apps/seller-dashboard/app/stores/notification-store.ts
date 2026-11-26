'use client';

import { create } from 'zustand';
import type { SellerNotification } from '../components/engagement/engagement-api';

/**
 * The bell's state. The server is the source of truth (engagement API,
 * GET /notifications); this holds the last list it returned, and applies
 * "mark as read" straight away while the request is on its way.
 */
interface NotificationStore {
  /** Last 50, newest first. */
  notifications: SellerNotification[];
  unreadCount: number;
  isHistoryOpen: boolean;

  /** Replace with what the server returned. */
  setFromServer: (notifications: SellerNotification[], unreadCount: number) => void;
  markAsReadLocal: (id: string) => void;
  markAllAsReadLocal: () => void;
  toggleHistory: () => void;
  setHistoryOpen: (open: boolean) => void;
}

export const useNotificationStore = create<NotificationStore>((set) => ({
  notifications: [],
  unreadCount: 0,
  isHistoryOpen: false,

  setFromServer: (notifications, unreadCount) => set({ notifications, unreadCount }),

  markAsReadLocal: (id) =>
    set((state) => {
      const notifications = state.notifications.map((n) => (n.id === id ? { ...n, read: true } : n));
      return { notifications, unreadCount: notifications.filter((n) => !n.read).length };
    }),

  markAllAsReadLocal: () =>
    set((state) => ({ notifications: state.notifications.map((n) => ({ ...n, read: true })), unreadCount: 0 })),

  toggleHistory: () => set((state) => ({ isHistoryOpen: !state.isHistoryOpen })),

  setHistoryOpen: (isHistoryOpen) => set({ isHistoryOpen }),
}));
