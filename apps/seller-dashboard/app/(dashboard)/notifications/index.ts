/**
 * Notification system barrel exports.
 *
 * Provides WebSocket manager, Zustand store, notification dropdown,
 * and notification provider for the seller dashboard.
 */

export { WebSocketManager } from './websocket-manager';
export type { ConnectionStatus } from './websocket-manager';

export { useNotificationStore } from './notification-store';
export type { NotificationStoreState } from './notification-store';

export { NotificationDropdown } from './NotificationDropdown';
export { NotificationProvider } from './NotificationProvider';
