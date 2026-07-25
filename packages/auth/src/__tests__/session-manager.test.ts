import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { SessionManager } from '../session-manager';

describe('SessionManager', () => {
  let refreshSession: ReturnType<typeof vi.fn>;
  let logout: ReturnType<typeof vi.fn>;
  let manager: SessionManager;

  beforeEach(() => {
    vi.useFakeTimers();
    refreshSession = vi.fn().mockResolvedValue('new-token');
    logout = vi.fn().mockResolvedValue(undefined);
    manager = new SessionManager(refreshSession, logout);
  });

  afterEach(() => {
    manager.stop();
    vi.useRealTimers();
  });

  describe('start()', () => {
    it('should not call refreshSession before 55 minutes', () => {
      manager.start();

      // Advance 54 minutes (just under threshold)
      vi.advanceTimersByTime(54 * 60 * 1000);

      expect(refreshSession).not.toHaveBeenCalled();
    });

    it('should call refreshSession at the 55-minute mark', async () => {
      manager.start();

      // Advance exactly one interval tick past 55 minutes
      vi.advanceTimersByTime(55 * 60 * 1000);
      // Trigger the next interval check
      vi.advanceTimersByTime(60 * 1000);
      // Allow the async callback to resolve
      await Promise.resolve();

      expect(refreshSession).toHaveBeenCalled();
    });

    it('should call logout if refreshSession fails', async () => {
      refreshSession.mockRejectedValueOnce(new Error('Refresh failed'));
      manager.start();

      // Advance past 55-minute mark to trigger interval
      vi.advanceTimersByTime(55 * 60 * 1000 + 60 * 1000);

      // Allow the async promise chain to resolve (refresh -> catch -> logout)
      await Promise.resolve();
      await Promise.resolve();
      await Promise.resolve();

      expect(logout).toHaveBeenCalledTimes(1);
    });

    it('should reset session start time after successful refresh', async () => {
      manager.start();

      // Advance to trigger first refresh (55min elapsed + next check at 60s)
      vi.advanceTimersByTime(55 * 60 * 1000 + 60 * 1000);
      // Allow the async refresh to complete and reset the timer
      await Promise.resolve();
      await Promise.resolve();

      expect(refreshSession).toHaveBeenCalled();
      refreshSession.mockClear();

      // After reset, advancing 30 minutes (30 intervals of 60s each)
      // should NOT trigger refresh because session was just reset
      for (let i = 0; i < 30; i++) {
        vi.advanceTimersByTime(60 * 1000);
        await Promise.resolve();
      }

      expect(refreshSession).not.toHaveBeenCalled();
    });
  });

  describe('stop()', () => {
    it('should clear the interval and prevent further refreshes', () => {
      manager.start();
      manager.stop();

      // Advance well past 55 minutes
      vi.advanceTimersByTime(120 * 60 * 1000);

      expect(refreshSession).not.toHaveBeenCalled();
    });

    it('should be safe to call multiple times', () => {
      manager.start();
      manager.stop();
      manager.stop(); // Should not throw
    });
  });

  describe('getTimeUntilExpiry()', () => {
    it('should return 60 minutes at session start', () => {
      manager.start();
      const ttl = manager.getTimeUntilExpiry();
      // Should be approximately 60 minutes (within a small tolerance)
      expect(ttl).toBeLessThanOrEqual(60 * 60 * 1000);
      expect(ttl).toBeGreaterThan(59 * 60 * 1000);
    });

    it('should decrease as time passes', () => {
      manager.start();
      vi.advanceTimersByTime(10 * 60 * 1000); // 10 minutes

      const ttl = manager.getTimeUntilExpiry();
      expect(ttl).toBeLessThanOrEqual(50 * 60 * 1000);
      expect(ttl).toBeGreaterThan(49 * 60 * 1000);
    });

    it('should return 0 after token TTL expires', () => {
      manager.start();
      vi.advanceTimersByTime(61 * 60 * 1000); // 61 minutes

      expect(manager.getTimeUntilExpiry()).toBe(0);
    });
  });

  describe('isExpiringSoon()', () => {
    it('should return false when token has plenty of time', () => {
      manager.start();
      expect(manager.isExpiringSoon()).toBe(false);
    });

    it('should return true when less than 5 minutes remain', () => {
      manager.start();
      vi.advanceTimersByTime(56 * 60 * 1000); // 56 minutes elapsed

      expect(manager.isExpiringSoon()).toBe(true);
    });

    it('should return true when token is expired', () => {
      manager.start();
      vi.advanceTimersByTime(61 * 60 * 1000); // 61 minutes elapsed

      expect(manager.isExpiringSoon()).toBe(true);
    });
  });
});
