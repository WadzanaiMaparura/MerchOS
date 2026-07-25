'use client';

/**
 * SessionManager — Proactive token refresh and expiry detection.
 * Refreshes the access token at the 55-minute mark (before the 60-min TTL expires).
 * Checks every 60 seconds and triggers logout if refresh fails.
 *
 * Implements FR-11.1: Frontend SHALL proactively refresh tokens at the 55-minute mark.
 * Implements FR-11.3: If refresh fails, user SHALL be redirected to login.
 */

/** 55 minutes in milliseconds — threshold to trigger refresh */
const REFRESH_THRESHOLD_MS = 55 * 60 * 1000;

/** 5 minutes in milliseconds — considered "expiring soon" */
const EXPIRING_SOON_THRESHOLD_MS = 5 * 60 * 1000;

/** Check interval: 60 seconds */
const CHECK_INTERVAL_MS = 60 * 1000;

export class SessionManager {
  private refreshSession: () => Promise<string>;
  private logout: () => Promise<void>;
  private intervalId: ReturnType<typeof setInterval> | null = null;
  private sessionStartTime: number = Date.now();
  private isRefreshing: boolean = false;

  constructor(refreshSession: () => Promise<string>, logout: () => Promise<void>) {
    this.refreshSession = refreshSession;
    this.logout = logout;
  }

  /**
   * Start the session manager. Begins a timer that checks every 60 seconds
   * and refreshes the token at the 55-minute mark.
   */
  start(): void {
    // Reset session start time
    this.sessionStartTime = Date.now();
    this.isRefreshing = false;

    // Clear any existing interval
    this.stop();

    this.intervalId = setInterval(async () => {
      if (this.isRefreshing) return;

      const elapsed = Date.now() - this.sessionStartTime;

      if (elapsed >= REFRESH_THRESHOLD_MS) {
        this.isRefreshing = true;
        try {
          await this.refreshSession();
          // Reset timer after successful refresh
          this.sessionStartTime = Date.now();
        } catch {
          // Refresh failed — log out per FR-11.3
          await this.logout();
        } finally {
          this.isRefreshing = false;
        }
      }
    }, CHECK_INTERVAL_MS);
  }

  /**
   * Stop the session manager and clear the interval timer.
   */
  stop(): void {
    if (this.intervalId !== null) {
      clearInterval(this.intervalId);
      this.intervalId = null;
    }
  }

  /**
   * Get the time in milliseconds until the access token expires.
   * Based on the 60-minute TTL from session start.
   */
  getTimeUntilExpiry(): number {
    const elapsed = Date.now() - this.sessionStartTime;
    const tokenTtlMs = 60 * 60 * 1000; // 60 minutes
    return Math.max(0, tokenTtlMs - elapsed);
  }

  /**
   * Returns true if the token will expire in less than 5 minutes.
   */
  isExpiringSoon(): boolean {
    return this.getTimeUntilExpiry() < EXPIRING_SOON_THRESHOLD_MS;
  }
}
