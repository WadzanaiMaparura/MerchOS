import { describe, it, expect } from 'vitest';
import { CircuitBreaker } from '../../utils/circuit-breaker';

describe('CircuitBreaker', () => {
  function createBreaker(clock?: () => number) {
    return new CircuitBreaker(
      { failureThreshold: 5, failureWindowMs: 60_000, openDurationMs: 120_000 },
      clock
    );
  }

  describe('initial state', () => {
    it('starts in CLOSED state for unknown domains', () => {
      const cb = createBreaker();
      expect(cb.getState('example.com')).toBe('CLOSED');
    });

    it('allows requests in CLOSED state', () => {
      const cb = createBreaker();
      expect(cb.canRequest('example.com')).toBe(true);
    });
  });

  describe('CLOSED → OPEN transition', () => {
    it('stays CLOSED with fewer than 5 failures', () => {
      const cb = createBreaker();
      for (let i = 0; i < 4; i++) {
        cb.recordFailure('example.com');
      }
      expect(cb.getState('example.com')).toBe('CLOSED');
      expect(cb.canRequest('example.com')).toBe(true);
    });

    it('transitions to OPEN after exactly 5 consecutive failures within 60s', () => {
      let now = 1000;
      const cb = createBreaker(() => now);

      for (let i = 0; i < 5; i++) {
        cb.recordFailure('example.com');
        now += 1000; // 1s between failures
      }

      expect(cb.getState('example.com')).toBe('OPEN');
      expect(cb.canRequest('example.com')).toBe(false);
    });

    it('does NOT transition to OPEN if failures are spread beyond 60s window', () => {
      let now = 0;
      const cb = createBreaker(() => now);

      // Record 3 failures early
      for (let i = 0; i < 3; i++) {
        cb.recordFailure('example.com');
        now += 1000;
      }

      // Jump beyond the 60s window
      now += 61_000;

      // Record 2 more failures — total within window is only 2
      for (let i = 0; i < 2; i++) {
        cb.recordFailure('example.com');
        now += 1000;
      }

      expect(cb.getState('example.com')).toBe('CLOSED');
    });

    it('rejects requests when OPEN', () => {
      let now = 1000;
      const cb = createBreaker(() => now);

      for (let i = 0; i < 5; i++) {
        cb.recordFailure('example.com');
        now += 100;
      }

      expect(cb.canRequest('example.com')).toBe(false);
    });
  });

  describe('OPEN → HALF_OPEN transition', () => {
    it('transitions to HALF_OPEN after 120s cooldown', () => {
      let now = 1000;
      const cb = createBreaker(() => now);

      for (let i = 0; i < 5; i++) {
        cb.recordFailure('example.com');
        now += 100;
      }

      expect(cb.getState('example.com')).toBe('OPEN');

      // Advance past the 120s cooldown
      now += 120_000;

      expect(cb.getState('example.com')).toBe('HALF_OPEN');
      expect(cb.canRequest('example.com')).toBe(true);
    });

    it('stays OPEN before 120s cooldown elapses', () => {
      let now = 1000;
      const cb = createBreaker(() => now);

      for (let i = 0; i < 5; i++) {
        cb.recordFailure('example.com');
        now += 100;
      }

      // openedAt was set at the 5th failure (now=1400), loop leaves now=1500
      // Set now to openedAt + 119_999 to be just under the threshold
      now = 1400 + 119_999;

      expect(cb.getState('example.com')).toBe('OPEN');
      expect(cb.canRequest('example.com')).toBe(false);
    });
  });

  describe('HALF_OPEN outcomes', () => {
    it('transitions back to CLOSED on success in HALF_OPEN', () => {
      let now = 1000;
      const cb = createBreaker(() => now);

      // Open the circuit
      for (let i = 0; i < 5; i++) {
        cb.recordFailure('example.com');
        now += 100;
      }

      // Wait for cooldown
      now += 120_000;
      expect(cb.getState('example.com')).toBe('HALF_OPEN');

      // Probe succeeds
      cb.recordSuccess('example.com');
      expect(cb.getState('example.com')).toBe('CLOSED');
      expect(cb.canRequest('example.com')).toBe(true);
    });

    it('transitions back to OPEN on failure in HALF_OPEN', () => {
      let now = 1000;
      const cb = createBreaker(() => now);

      // Open the circuit
      for (let i = 0; i < 5; i++) {
        cb.recordFailure('example.com');
        now += 100;
      }

      // Wait for cooldown
      now += 120_000;
      expect(cb.getState('example.com')).toBe('HALF_OPEN');

      // Probe fails
      cb.recordFailure('example.com');
      expect(cb.getState('example.com')).toBe('OPEN');
      expect(cb.canRequest('example.com')).toBe(false);
    });
  });

  describe('domain isolation', () => {
    it('tracks state independently per domain', () => {
      let now = 1000;
      const cb = createBreaker(() => now);

      // Open circuit for domain A
      for (let i = 0; i < 5; i++) {
        cb.recordFailure('domainA.com');
        now += 100;
      }

      expect(cb.getState('domainA.com')).toBe('OPEN');
      expect(cb.getState('domainB.com')).toBe('CLOSED');
      expect(cb.canRequest('domainA.com')).toBe(false);
      expect(cb.canRequest('domainB.com')).toBe(true);
    });
  });

  describe('recordSuccess resets state', () => {
    it('resets failure count in CLOSED state', () => {
      let now = 1000;
      const cb = createBreaker(() => now);

      // Record 4 failures
      for (let i = 0; i < 4; i++) {
        cb.recordFailure('example.com');
        now += 100;
      }

      // Success resets
      cb.recordSuccess('example.com');

      // 4 more failures should not open (only 4 since reset)
      for (let i = 0; i < 4; i++) {
        cb.recordFailure('example.com');
        now += 100;
      }

      expect(cb.getState('example.com')).toBe('CLOSED');
    });
  });
});
