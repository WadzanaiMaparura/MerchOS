/**
 * Notification and WebSocket types for the MerchOS frontend.
 */

import { EventType } from './common';

/** An in-app notification received via WebSocket or polling. */
export interface Notification {
  id: string;
  type: EventType;
  title: string;
  message: string;
  resourceId?: string;
  timestamp: string; // ISO 8601
  read: boolean;
}

/** Configuration for the WebSocket notification manager. */
export interface WebSocketManagerConfig {
  url: string;
  getAccessToken: () => Promise<string>;
  onMessage: (notification: Notification) => void;
  onConnectionChange: (connected: boolean) => void;
  maxReconnectAttempts: number; // default: 5
  maxBackoff: number; // default: 30000ms
  pollingInterval: number; // default: 30000ms (fallback)
}
