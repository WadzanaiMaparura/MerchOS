'use client';

import { create } from 'zustand';

export type ErrorNotificationType = 'error' | 'access-denied' | 'timeout' | 'network';

export interface ErrorNotification {
  id: string;
  type: ErrorNotificationType;
  title: string;
  message: string;
  /** Whether to allow retry. HTTP 403 errors should not allow retry. */
  allowRetry: boolean;
  /** Timestamp of when the notification was created */
  createdAt: number;
  /** Timer ID for auto-dismiss */
  timerId?: ReturnType<typeof setTimeout>;
}

interface ErrorStore {
  /** Currently displayed error notifications (max 3) */
  notifications: ErrorNotification[];
  /** Whether the app is currently offline */
  isOffline: boolean;
  /** Timestamp when connectivity was last restored */
  reconnectedAt: number | null;

  /** Add an error notification (max 3, oldest dismissed first) */
  addError: (error: Omit<ErrorNotification, 'id' | 'createdAt'>) => string;
  /** Dismiss a specific error notification */
  dismissError: (id: string) => void;
  /** Set the offline status */
  setOffline: (offline: boolean) => void;
  /** Clear all error notifications */
  clearAll: () => void;
}

let counter = 0;

export const useErrorStore = create<ErrorStore>((set, get) => ({
  notifications: [],
  isOffline: false,
  reconnectedAt: null,

  addError: (error) => {
    const id = `error-${++counter}-${Date.now()}`;
    const notification: ErrorNotification = {
      ...error,
      id,
      createdAt: Date.now(),
    };

    set((state) => {
      let updated = [...state.notifications, notification];
      // Enforce max 3: remove oldest first
      if (updated.length > 3) {
        // Clear timers on dismissed notifications
        const removed = updated.slice(0, updated.length - 3);
        removed.forEach((n) => {
          if (n.timerId) clearTimeout(n.timerId);
        });
        updated = updated.slice(updated.length - 3);
      }
      return { notifications: updated };
    });

    // Auto-dismiss after 8 seconds
    const timerId = setTimeout(() => {
      get().dismissError(id);
    }, 8000);

    // Store the timer ID
    set((state) => ({
      notifications: state.notifications.map((n) =>
        n.id === id ? { ...n, timerId } : n
      ),
    }));

    return id;
  },

  dismissError: (id) => {
    set((state) => {
      const notification = state.notifications.find((n) => n.id === id);
      if (notification?.timerId) {
        clearTimeout(notification.timerId);
      }
      return {
        notifications: state.notifications.filter((n) => n.id !== id),
      };
    });
  },

  setOffline: (offline) => {
    set({
      isOffline: offline,
      reconnectedAt: offline ? null : Date.now(),
    });
  },

  clearAll: () => {
    const { notifications } = get();
    notifications.forEach((n) => {
      if (n.timerId) clearTimeout(n.timerId);
    });
    set({ notifications: [] });
  },
}));
