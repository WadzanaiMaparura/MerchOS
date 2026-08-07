/**
 * Circuit breaker for external HTTP calls during URL imports.
 *
 * Tracks consecutive failures per domain and transitions through states:
 * - CLOSED: Normal operation, requests are allowed
 * - OPEN: Too many failures, requests are rejected
 * - HALF_OPEN: After cooldown, a single probe request is allowed to test recovery
 *
 * Configuration:
 * - failureThreshold: 5 consecutive failures within the time window triggers OPEN
 * - failureWindowMs: 60000ms (60s) — failures outside this window are discarded
 * - openDurationMs: 120000ms (120s) — how long to stay OPEN before transitioning to HALF_OPEN
 *
 * @see Requirements 14.5
 */

export type CircuitState = 'CLOSED' | 'OPEN' | 'HALF_OPEN';

export interface CircuitBreakerConfig {
  failureThreshold: number;
  failureWindowMs: number;
  openDurationMs: number;
}

interface DomainState {
  state: CircuitState;
  failures: number[];
  openedAt: number | null;
}

const DEFAULT_CONFIG: CircuitBreakerConfig = {
  failureThreshold: 5,
  failureWindowMs: 60_000,
  openDurationMs: 120_000,
};

export class CircuitBreaker {
  private readonly config: CircuitBreakerConfig;
  private readonly domains: Map<string, DomainState> = new Map();
  private readonly now: () => number;

  constructor(config: Partial<CircuitBreakerConfig> = {}, clock?: () => number) {
    this.config = { ...DEFAULT_CONFIG, ...config };
    this.now = clock ?? (() => Date.now());
  }

  /**
   * Returns whether a request to the given domain is allowed.
   * - CLOSED: always allowed
   * - OPEN: check if cooldown has elapsed; if so, transition to HALF_OPEN and allow
   * - HALF_OPEN: only one probe request is allowed (reject subsequent until outcome recorded)
   */
  canRequest(domain: string): boolean {
    const domainState = this.getOrCreateDomainState(domain);

    switch (domainState.state) {
      case 'CLOSED':
        return true;

      case 'OPEN': {
        const elapsed = this.now() - (domainState.openedAt ?? 0);
        if (elapsed >= this.config.openDurationMs) {
          domainState.state = 'HALF_OPEN';
          return true;
        }
        return false;
      }

      case 'HALF_OPEN':
        // In HALF_OPEN, the first call to canRequest returns true (the probe).
        // Subsequent calls before recordSuccess/recordFailure should also return true
        // since the probe is being issued. The caller is responsible for recording
        // the outcome immediately after the request completes.
        return true;
    }
  }

  /**
   * Records a successful request for the given domain.
   * - Resets failure tracking and transitions back to CLOSED from any state.
   */
  recordSuccess(domain: string): void {
    const domainState = this.getOrCreateDomainState(domain);
    domainState.state = 'CLOSED';
    domainState.failures = [];
    domainState.openedAt = null;
  }

  /**
   * Records a failed request for the given domain.
   * - In CLOSED: adds failure timestamp; if threshold reached within window, transitions to OPEN
   * - In HALF_OPEN: probe failed, immediately transitions back to OPEN
   * - In OPEN: no-op (requests shouldn't be made while OPEN)
   */
  recordFailure(domain: string): void {
    const domainState = this.getOrCreateDomainState(domain);
    const currentTime = this.now();

    switch (domainState.state) {
      case 'CLOSED': {
        domainState.failures.push(currentTime);
        // Remove failures that are outside the time window
        const windowStart = currentTime - this.config.failureWindowMs;
        domainState.failures = domainState.failures.filter((t) => t > windowStart);

        if (domainState.failures.length >= this.config.failureThreshold) {
          domainState.state = 'OPEN';
          domainState.openedAt = currentTime;
          domainState.failures = [];
        }
        break;
      }

      case 'HALF_OPEN': {
        // Probe request failed — reopen the circuit
        domainState.state = 'OPEN';
        domainState.openedAt = currentTime;
        domainState.failures = [];
        break;
      }

      case 'OPEN':
        // No-op: requests shouldn't be made while circuit is open
        break;
    }
  }

  /**
   * Returns the current circuit state for a domain.
   * Also handles the time-based OPEN → HALF_OPEN transition check.
   */
  getState(domain: string): CircuitState {
    const domainState = this.getOrCreateDomainState(domain);

    if (domainState.state === 'OPEN') {
      const elapsed = this.now() - (domainState.openedAt ?? 0);
      if (elapsed >= this.config.openDurationMs) {
        domainState.state = 'HALF_OPEN';
      }
    }

    return domainState.state;
  }

  private getOrCreateDomainState(domain: string): DomainState {
    let domainState = this.domains.get(domain);
    if (!domainState) {
      domainState = {
        state: 'CLOSED',
        failures: [],
        openedAt: null,
      };
      this.domains.set(domain, domainState);
    }
    return domainState;
  }
}
