import type { Notification, WebSocketManagerConfig } from '@merch-os/types';

/**
 * WebSocketManager - Manages WebSocket connection for real-time notifications.
 *
 * Features:
 * - Automatic reconnection with exponential backoff
 * - Fallback to HTTP polling when WebSocket is unavailable
 * - Retrieves missed notifications on reconnection
 * - Token-based authentication
 */
export class WebSocketManager {
  private config: WebSocketManagerConfig;
  private ws: WebSocket | null = null;
  private reconnectAttempts = 0;
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  private pollingTimer: ReturnType<typeof setInterval> | null = null;
  private isConnected = false;
  private isDestroyed = false;
  private lastEventTimestamp: string | null = null;
  private usePollingFallback = false;
  private unreadCount = 0;

  constructor(config: WebSocketManagerConfig) {
    this.config = config;
  }

  /**
   * Establish WebSocket connection with authentication token.
   */
  async connect(): Promise<void> {
    if (this.isDestroyed) return;

    try {
      const token = await this.config.getAccessToken();
      const url = `${this.config.url}?token=${encodeURIComponent(token)}`;

      this.ws = new WebSocket(url);
      this.setupEventHandlers();
    } catch (error) {
      // If we can't get a token, start polling instead
      this.startPollingFallback();
    }
  }

  /**
   * Disconnect and clean up all timers and connections.
   */
  disconnect(): void {
    this.isDestroyed = true;
    this.cleanup();
    this.config.onConnectionChange(false);
  }

  /**
   * Mark a notification as read via the WebSocket connection.
   */
  markAsRead(notificationId: string): void {
    if (this.ws && this.isConnected) {
      this.ws.send(
        JSON.stringify({
          action: 'markAsRead',
          notificationId,
        })
      );
    }
  }

  /**
   * Get the count of unread notifications received during this session.
   * Note: The authoritative unread count is maintained by the Zustand store.
   */
  getUnreadCount(): number {
    return this.unreadCount;
  }

  /**
   * Get the current connection state.
   */
  getConnectionStatus(): 'connected' | 'reconnecting' | 'polling' | 'disconnected' {
    if (this.isConnected) return 'connected';
    if (this.usePollingFallback) return 'polling';
    if (this.reconnectAttempts > 0 && !this.isDestroyed) return 'reconnecting';
    return 'disconnected';
  }

  private setupEventHandlers(): void {
    if (!this.ws) return;

    this.ws.onopen = () => {
      this.isConnected = true;
      this.reconnectAttempts = 0;
      this.usePollingFallback = false;
      this.stopPolling();
      this.config.onConnectionChange(true);

      // On reconnection, request missed notifications
      if (this.lastEventTimestamp) {
        this.requestMissedNotifications();
      }
    };

    this.ws.onmessage = (event: MessageEvent) => {
      try {
        const data = JSON.parse(event.data);

        if (data.type === 'notification') {
          const notification: Notification = data.payload;
          this.lastEventTimestamp = notification.timestamp;
          if (!notification.read) this.unreadCount++;
          this.config.onMessage(notification);
        } else if (data.type === 'missed_notifications') {
          // Handle batch of missed notifications
          const notifications: Notification[] = data.payload;
          notifications.forEach((notification) => {
            this.lastEventTimestamp = notification.timestamp;
            if (!notification.read) this.unreadCount++;
            this.config.onMessage(notification);
          });
        }
      } catch {
        // Ignore malformed messages
      }
    };

    this.ws.onclose = (event: CloseEvent) => {
      this.isConnected = false;
      this.config.onConnectionChange(false);

      // Don't reconnect if intentionally closed or destroyed
      if (this.isDestroyed || event.code === 1000) return;

      this.attemptReconnect();
    };

    this.ws.onerror = () => {
      // Error will trigger onclose, which handles reconnection
      if (this.ws) {
        this.ws.close();
      }
    };
  }

  private attemptReconnect(): void {
    if (this.isDestroyed) return;

    if (this.reconnectAttempts >= this.config.maxReconnectAttempts) {
      // Max reconnect attempts reached — fall back to polling
      this.startPollingFallback();
      return;
    }

    // Exponential backoff: 1s, 2s, 4s, 8s, 16s... capped at maxBackoff
    const baseDelay = 1000;
    const delay = Math.min(
      baseDelay * Math.pow(2, this.reconnectAttempts),
      this.config.maxBackoff
    );

    this.reconnectAttempts++;

    this.reconnectTimer = setTimeout(() => {
      this.connect();
    }, delay);
  }

  private requestMissedNotifications(): void {
    if (this.ws && this.isConnected && this.lastEventTimestamp) {
      this.ws.send(
        JSON.stringify({
          action: 'getMissed',
          since: this.lastEventTimestamp,
        })
      );
    }
  }

  private startPollingFallback(): void {
    if (this.isDestroyed || this.pollingTimer) return;

    this.usePollingFallback = true;
    this.config.onConnectionChange(false);

    // Immediately poll once
    this.poll();

    // Then poll at the configured interval
    this.pollingTimer = setInterval(() => {
      this.poll();
    }, this.config.pollingInterval);
  }

  private async poll(): Promise<void> {
    if (this.isDestroyed) return;

    try {
      const token = await this.config.getAccessToken();
      const params = this.lastEventTimestamp
        ? `?since=${encodeURIComponent(this.lastEventTimestamp)}`
        : '';

      // Derive REST endpoint from WebSocket URL
      const restUrl = this.config.url
        .replace('wss://', 'https://')
        .replace('ws://', 'http://')
        .replace(/\/ws\/?$/, '/notifications');

      const response = await fetch(`${restUrl}${params}`, {
        headers: {
          Authorization: `Bearer ${token}`,
        },
      });

      if (response.ok) {
        const data = await response.json();
        const notifications: Notification[] = data.notifications || [];
        notifications.forEach((notification) => {
          this.lastEventTimestamp = notification.timestamp;
          this.config.onMessage(notification);
        });
      }
    } catch {
      // Polling failed — will retry on next interval
    }
  }

  private stopPolling(): void {
    if (this.pollingTimer) {
      clearInterval(this.pollingTimer);
      this.pollingTimer = null;
    }
  }

  private cleanup(): void {
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }

    this.stopPolling();

    if (this.ws) {
      this.ws.onopen = null;
      this.ws.onmessage = null;
      this.ws.onclose = null;
      this.ws.onerror = null;
      this.ws.close(1000, 'Client disconnecting');
      this.ws = null;
    }

    this.isConnected = false;
  }
}
