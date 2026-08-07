/**
 * URL Import Engine types — crawl configuration, sessions, and duplicate detection.
 * Requirements: 4.1, 4.2, 4.3, 4.10, 4.11, 7.1, 7.2, 14.5
 */

// ---------------------------------------------------------------------------
// Crawl Configuration
// ---------------------------------------------------------------------------

/**
 * Configuration for the URL Import Engine crawl behaviour.
 */
export interface CrawlConfig {
  /** Maximum link depth from seed URL (default: 3, max: 5) */
  maxDepth: number;
  /** Maximum requests per second per domain (default: 1) */
  rateLimit: number;
  /** Number of consecutive failures before circuit breaker opens */
  circuitBreakerThreshold: number;
  /** Duration in ms to pause crawling when circuit breaker is open (default: 120000) */
  circuitBreakerPauseMs: number;
  /** Whether to persist progress state for session resumption */
  resumable: boolean;
}

// ---------------------------------------------------------------------------
// Crawl Session
// ---------------------------------------------------------------------------

/** State of the circuit breaker for a specific domain. */
export type CircuitBreakerState = 'CLOSED' | 'OPEN' | 'HALF_OPEN';

/**
 * Represents a single URL crawl execution with progress tracking and resumability.
 */
export interface CrawlSession {
  sessionId: string;
  importJobId: string;
  tenantId: string;
  supplierId: string;
  /** The seed URL that initiated this crawl */
  seedUrl: string;
  /** Applied crawl configuration */
  config: CrawlConfig;
  /** URLs that have been successfully processed */
  visitedUrls: string[];
  /** URLs queued for processing */
  pendingUrls: string[];
  /** Current depth of the BFS traversal */
  currentDepth: number;
  /** Circuit breaker state per domain */
  circuitBreakerStates: Record<string, CircuitBreakerState>;
  /** Number of consecutive failures per domain (for circuit breaker tracking) */
  consecutiveFailures: Record<string, number>;
  /** ISO 8601 timestamp of the last request per domain (for rate limiting) */
  lastRequestTime: Record<string, string>;
  /** Whether the session has been completed */
  completed: boolean;
  /** ISO 8601 timestamp */
  startedAt: string;
  /** ISO 8601 timestamp */
  updatedAt: string;
}

// ---------------------------------------------------------------------------
// Crawl Statistics
// ---------------------------------------------------------------------------

/**
 * Statistics recorded upon crawl session completion.
 */
export interface CrawlStats {
  pagesCrawled: number;
  pagesSkipped: number;
  productsExtracted: number;
  imagesDownloaded: number;
  errorsEncountered: number;
  /** Total crawl duration in milliseconds */
  durationMs: number;
}

// ---------------------------------------------------------------------------
// Duplicate Detection
// ---------------------------------------------------------------------------

/** Type of match used to identify a duplicate. */
export type DuplicateMatchType = 'SKU_EXACT' | 'TITLE_SIMILAR';

/**
 * Result of checking a product record for duplicates against existing records.
 */
export interface DuplicateCheckResult {
  isDuplicate: boolean;
  matchType: DuplicateMatchType | null;
  /** Product ID of the matched existing product */
  matchedProductId: string | null;
  /** Normalised similarity score (0.0 - 1.0) for title-based matches */
  similarityScore: number | null;
}
