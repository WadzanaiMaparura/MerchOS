/**
 * Notification Store for the Seller Dashboard (dashboard route group)
 *
 * Re-exports the Zustand notification store from the app-level stores.
 * The store manages:
 * - notifications[] (max 50, newest first)
 * - unreadCount
 * - connectionStatus ('connected' | 'reconnecting' | 'polling' | 'disconnected')
 * - addNotification (deduplicates, caps at 50)
 * - markAsRead (updates unread count within 1 second)
 * - markAllAsRead
 * - setConnectionStatus
 * - isHistoryOpen / toggleHistory / setHistoryOpen
 *
 * Validates: Requirements 12.1, 12.2, 12.4, 12.5
 */

export { useNotificationStore } from '../../stores/notification-store';
export type { ConnectionStatus } from '../../stores/notification-store';
