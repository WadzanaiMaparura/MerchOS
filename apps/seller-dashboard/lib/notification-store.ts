/**
 * Re-export notification store from lib/stores/ for convenience.
 *
 * The canonical store lives at lib/stores/notification-store.ts per the spec.
 * The app/stores/ version is used by existing components — both are in sync.
 *
 * Validates: Requirements 12.1, 12.2, 12.4, 12.5
 */

export { useNotificationStore } from './stores/notification-store';
export type { ConnectionStatus, NotificationStoreState } from './stores/notification-store';
