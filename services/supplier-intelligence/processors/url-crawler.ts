/**
 * URL Crawler — robots.txt parsing, permission checking, BFS page crawling,
 * and URL import entry point.
 * Requirements: 4.1, 4.2, 4.3, 4.6, 4.8, 4.10, 4.13
 *
 * Responsibilities:
 * - Fetch and parse robots.txt from target domains
 * - Check whether a given URL path is allowed for crawling
 * - Reject crawl if target path is disallowed with a user-friendly message
 * - Initialise a CrawlSession for BFS traversal when crawling is permitted
 * - BFS page crawling with configurable depth limit
 * - Rate limiting (1 request/second/domain)
 * - Follow pagination links within depth budget
 * - Persist crawl progress state for resumability
 *
 * Design decisions:
 * - Default user-agent: 'MerchOS-Crawler/1.0'
 * - If robots.txt is not found (404), assume all paths are allowed
 * - If robots.txt fetch fails for other reasons (network error, 5xx), treat as disallowed
 *   to comply with requirement 4.13 (do not bypass access restrictions)
 * - BFS uses a queue with depth tracking per URL
 * - Rate limiting enforced per-domain using lastRequestTime map
 * - Pagination links (rel="next", rel="prev", common pagination selectors) followed within depth
 * - Crawl state persisted to allow resume after interruptions
 */

import robotsParser from 'robots-parser';
import { randomUUID } from 'node:crypto';
import * as cheerio from 'cheerio';
import type { CrawlConfig, CrawlSession } from '../types/crawl.types';

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

/** Default user-agent string used for robots.txt checks and crawl requests. */
export const DEFAULT_USER_AGENT = 'MerchOS-Crawler/1.0';

/** Timeout in milliseconds for fetching robots.txt. */
const ROBOTS_TXT_TIMEOUT_MS = 10_000;

/** Default crawl configuration values. */
const DEFAULT_CRAWL_CONFIG: CrawlConfig = {
  maxDepth: 3,
  rateLimit: 1,
  circuitBreakerThreshold: 5,
  circuitBreakerPauseMs: 120_000,
  resumable: true,
};

/** Timeout in milliseconds for page fetches during crawling. */
const PAGE_FETCH_TIMEOUT_MS = 30_000;

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/**
 * Result of checking robots.txt permissions for a target URL.
 */
export interface RobotsTxtResult {
  /** Whether crawling the target URL path is permitted */
  allowed: boolean;
  /** Human-readable explanation when crawling is disallowed */
  reason?: string;
  /** Crawl delay in seconds specified by robots.txt for the user-agent, if any */
  crawlDelay?: number;
}

/** @deprecated Use RobotsTxtResult instead */
export type RobotsCheckResult = RobotsTxtResult;

/**
 * Error thrown when a crawl is rejected due to robots.txt restrictions.
 */
export class CrawlDisallowedError extends Error {
  public readonly statusCode = 422;

  constructor(message: string) {
    super(message);
    this.name = 'CrawlDisallowedError';
  }
}

/**
 * Parameters for initialising a new crawl session.
 */
export interface InitCrawlSessionParams {
  /** The URL to start crawling from */
  url: string;
  /** Import job identifier this crawl belongs to */
  importJobId: string;
  /** Tenant identifier from JWT context */
  tenantId: string;
  /** Supplier identifier */
  supplierId: string;
  /** Optional crawl configuration overrides */
  config?: Partial<CrawlConfig>;
  /** Optional user-agent string */
  userAgent?: string;
}

// ---------------------------------------------------------------------------
// robots.txt Fetching and Parsing
// ---------------------------------------------------------------------------

/**
 * Extract the robots.txt URL from a target URL.
 * Constructs `{protocol}://{host}/robots.txt`.
 */
export function getRobotsTxtUrl(targetUrl: string): string {
  const parsed = new URL(targetUrl);
  return `${parsed.protocol}//${parsed.host}/robots.txt`;
}

/**
 * Fetch the robots.txt content from a domain.
 *
 * @param robotsTxtUrl - Full URL to the robots.txt file
 * @returns The robots.txt content as a string, or null if not found (404)
 * @throws Error for network failures or non-404 HTTP errors
 */
export async function fetchRobotsTxt(robotsTxtUrl: string): Promise<string | null> {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), ROBOTS_TXT_TIMEOUT_MS);

  try {
    const response = await fetch(robotsTxtUrl, {
      method: 'GET',
      headers: {
        'User-Agent': DEFAULT_USER_AGENT,
      },
      signal: controller.signal,
      redirect: 'follow',
    });

    if (response.status === 404) {
      // No robots.txt means all paths are allowed
      return null;
    }

    if (!response.ok) {
      throw new Error(
        `Failed to fetch robots.txt: HTTP ${response.status} ${response.statusText}`
      );
    }

    return await response.text();
  } finally {
    clearTimeout(timeoutId);
  }
}

/**
 * Check whether a target URL is allowed to be crawled according to the domain's robots.txt.
 *
 * This function:
 * 1. Fetches robots.txt from the target domain
 * 2. Parses it using the robots-parser library
 * 3. Checks if the target URL path is allowed for the given user-agent
 *
 * @param url - The target URL to check crawl permissions for
 * @param userAgent - Optional user-agent string (defaults to 'MerchOS-Crawler/1.0')
 * @returns RobotsTxtResult indicating whether crawling is permitted
 */
export async function checkRobotsTxt(
  url: string,
  userAgent: string = DEFAULT_USER_AGENT
): Promise<RobotsTxtResult> {
  // Validate the target URL
  let parsedUrl: URL;
  try {
    parsedUrl = new URL(url);
  } catch {
    return {
      allowed: false,
      reason: `Invalid URL: "${url}" is not a valid URL.`,
    };
  }

  // Only allow http/https protocols
  if (!['http:', 'https:'].includes(parsedUrl.protocol)) {
    return {
      allowed: false,
      reason: `Unsupported protocol: "${parsedUrl.protocol}" — only HTTP and HTTPS URLs are supported.`,
    };
  }

  const robotsTxtUrl = getRobotsTxtUrl(url);

  let robotsTxtContent: string | null;
  try {
    robotsTxtContent = await fetchRobotsTxt(robotsTxtUrl);
  } catch (error) {
    // If we cannot fetch robots.txt (network error, 5xx, timeout),
    // we treat it as disallowed to comply with requirement 4.13
    // (do not bypass access restrictions)
    const message = error instanceof Error ? error.message : 'Unknown error';
    return {
      allowed: false,
      reason:
        `Unable to verify crawl permissions for ${parsedUrl.host}: ${message}. ` +
        `The import was rejected because we could not confirm the website permits automated data collection.`,
    };
  }

  // If robots.txt is not found (404), all paths are allowed
  if (robotsTxtContent === null) {
    return {
      allowed: true,
    };
  }

  // Parse robots.txt and check permissions
  const robot = robotsParser(robotsTxtUrl, robotsTxtContent);
  const isAllowed = robot.isAllowed(url, userAgent);

  // robots-parser returns undefined if no matching rule is found — treat as allowed
  const allowed = isAllowed !== false;

  const crawlDelay = robot.getCrawlDelay(userAgent);

  if (!allowed) {
    return {
      allowed: false,
      reason:
        `The website ${parsedUrl.host} does not permit automated data collection for the path "${parsedUrl.pathname}". ` +
        `The site's robots.txt file disallows access for our crawler. ` +
        `Please contact the supplier directly to obtain their product data.`,
      crawlDelay: crawlDelay ?? undefined,
    };
  }

  return {
    allowed: true,
    crawlDelay: crawlDelay ?? undefined,
  };
}

/** @deprecated Use checkRobotsTxt instead */
export const checkRobotsPermission = checkRobotsTxt;

// ---------------------------------------------------------------------------
// Crawl Session Initialisation
// ---------------------------------------------------------------------------

/**
 * Initialise a new crawl session for URL-based imports.
 *
 * This is the main entry point for URL imports. It:
 * 1. Validates the target URL
 * 2. Checks robots.txt permissions for the target path
 * 3. If disallowed, throws a CrawlDisallowedError (HTTP 422)
 * 4. If allowed, creates and returns a CrawlSession ready for BFS traversal
 *
 * @param params - Configuration for the crawl session
 * @returns A fully initialised CrawlSession with the seed URL queued for processing
 * @throws CrawlDisallowedError if robots.txt disallows crawling the target path
 */
export async function initCrawlSession(params: InitCrawlSessionParams): Promise<CrawlSession> {
  const {
    url,
    importJobId,
    tenantId,
    supplierId,
    config: configOverrides,
    userAgent = DEFAULT_USER_AGENT,
  } = params;

  // Merge provided config with defaults
  const config: CrawlConfig = {
    ...DEFAULT_CRAWL_CONFIG,
    ...configOverrides,
  };

  // Check robots.txt permissions before starting the crawl
  const robotsResult = await checkRobotsTxt(url, userAgent);

  if (!robotsResult.allowed) {
    throw new CrawlDisallowedError(
      robotsResult.reason ??
        `The website does not permit automated data collection for the requested path.`
    );
  }

  // If robots.txt specifies a crawl delay, enforce it as a minimum rate limit
  if (robotsResult.crawlDelay !== undefined && robotsResult.crawlDelay > 0) {
    // crawlDelay from robots.txt is in seconds; rateLimit is requests/second
    // If crawlDelay is e.g. 2 seconds, effective rate is 0.5 req/sec
    const effectiveRate = 1 / robotsResult.crawlDelay;
    config.rateLimit = Math.min(config.rateLimit, effectiveRate);
  }

  const now = new Date().toISOString();
  const parsedUrl = new URL(url);

  const session: CrawlSession = {
    sessionId: randomUUID(),
    importJobId,
    tenantId,
    supplierId,
    seedUrl: url,
    config,
    visitedUrls: [],
    pendingUrls: [url],
    currentDepth: 0,
    circuitBreakerStates: { [parsedUrl.host]: 'CLOSED' },
    consecutiveFailures: { [parsedUrl.host]: 0 },
    lastRequestTime: {},
    completed: false,
    startedAt: now,
    updatedAt: now,
  };

  return session;
}

// ---------------------------------------------------------------------------
// BFS Page Crawler Types
// ---------------------------------------------------------------------------

/**
 * A URL entry in the BFS queue with its associated depth.
 */
export interface BfsQueueEntry {
  url: string;
  depth: number;
}

/**
 * Result of fetching a single page during the crawl.
 */
export interface CrawledPage {
  url: string;
  depth: number;
  html: string;
  statusCode: number;
  fetchedAt: string;
}

/**
 * Serialisable crawl progress state for resumability.
 * Persisted so that an interrupted crawl session can be resumed from the last checkpoint.
 */
export interface CrawlProgress {
  sessionId: string;
  visitedUrls: string[];
  pendingQueue: BfsQueueEntry[];
  crawledPages: CrawledPage[];
  updatedAt: string;
}

/**
 * Options for the `crawlPages` function.
 */
export interface CrawlPagesOptions {
  /** Custom fetch implementation for testing. Defaults to global fetch. */
  fetchFn?: typeof fetch;
  /** Callback invoked after each page is processed, for progress persistence. */
  onProgress?: (progress: CrawlProgress) => void | Promise<void>;
  /** If provided, used to resume a previous crawl session. */
  resumeFrom?: CrawlProgress;
}

// ---------------------------------------------------------------------------
// Rate Limiting
// ---------------------------------------------------------------------------

/**
 * Enforce rate limiting by waiting until the next allowed request time for a domain.
 * Ensures at most `rateLimit` requests per second per domain.
 *
 * @param domain - The target domain
 * @param session - The current crawl session (mutated: updates lastRequestTime)
 */
async function enforceRateLimit(domain: string, session: CrawlSession): Promise<void> {
  const lastTime = session.lastRequestTime[domain];
  if (!lastTime) {
    // No previous request — allow immediately
    session.lastRequestTime[domain] = new Date().toISOString();
    return;
  }

  const minIntervalMs = 1000 / session.config.rateLimit; // 1 req/sec => 1000ms interval
  const elapsed = Date.now() - new Date(lastTime).getTime();
  const waitMs = minIntervalMs - elapsed;

  if (waitMs > 0) {
    await delay(waitMs);
  }

  session.lastRequestTime[domain] = new Date().toISOString();
}

/**
 * Utility: delay for a given number of milliseconds.
 */
function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// ---------------------------------------------------------------------------
// Link Extraction
// ---------------------------------------------------------------------------

/**
 * Extract all valid same-origin links from an HTML page.
 * Includes pagination links (rel="next", rel="prev") and standard <a href> links.
 * Filters to same-origin only to stay on the target domain.
 *
 * @param html - The HTML content of the page
 * @param pageUrl - The URL of the page (used for resolving relative URLs)
 * @returns Array of absolute URLs discovered on the page
 */
export function extractLinks(html: string, pageUrl: string): string[] {
  const $ = cheerio.load(html);
  const baseUrl = new URL(pageUrl);
  const links = new Set<string>();

  // Extract standard anchor links
  $('a[href]').each((_, el) => {
    const href = $(el).attr('href');
    if (href) {
      const resolved = resolveUrl(href, baseUrl);
      if (resolved) links.add(resolved);
    }
  });

  // Extract pagination links from <link rel="next"/"prev">
  $('link[rel="next"][href], link[rel="prev"][href]').each((_, el) => {
    const href = $(el).attr('href');
    if (href) {
      const resolved = resolveUrl(href, baseUrl);
      if (resolved) links.add(resolved);
    }
  });

  // Extract pagination links from <a rel="next"/"prev">
  $('a[rel="next"][href], a[rel="prev"][href]').each((_, el) => {
    const href = $(el).attr('href');
    if (href) {
      const resolved = resolveUrl(href, baseUrl);
      if (resolved) links.add(resolved);
    }
  });

  return Array.from(links);
}

/**
 * Resolve a potentially relative URL against a base URL.
 * Returns null if the URL is invalid or not same-origin.
 *
 * @param href - The href attribute value (may be relative)
 * @param baseUrl - The base URL to resolve against
 * @returns Absolute URL string if valid and same-origin, null otherwise
 */
function resolveUrl(href: string, baseUrl: URL): string | null {
  try {
    // Skip fragment-only, javascript:, mailto:, tel: links
    if (
      href.startsWith('#') ||
      href.startsWith('javascript:') ||
      href.startsWith('mailto:') ||
      href.startsWith('tel:')
    ) {
      return null;
    }

    const resolved = new URL(href, baseUrl.origin + baseUrl.pathname);

    // Only follow same-origin links
    if (resolved.origin !== baseUrl.origin) {
      return null;
    }

    // Only http/https
    if (!['http:', 'https:'].includes(resolved.protocol)) {
      return null;
    }

    // Strip fragment
    resolved.hash = '';

    return resolved.toString();
  } catch {
    return null;
  }
}

// ---------------------------------------------------------------------------
// Page Fetching
// ---------------------------------------------------------------------------

/**
 * Fetch a single page with timeout and error handling.
 *
 * @param url - The URL to fetch
 * @param userAgent - The user-agent string to use
 * @param fetchFn - Optional custom fetch function (for testing)
 * @returns Object with html content and status code, or null if fetch failed
 */
async function fetchPage(
  url: string,
  userAgent: string,
  fetchFn: typeof fetch = globalThis.fetch
): Promise<{ html: string; statusCode: number } | null> {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), PAGE_FETCH_TIMEOUT_MS);

  try {
    const response = await fetchFn(url, {
      method: 'GET',
      headers: {
        'User-Agent': userAgent,
        Accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
      },
      signal: controller.signal,
      redirect: 'follow',
    });

    const statusCode = response.status;

    // On HTTP errors (4xx/5xx), log and skip page per requirement 4.9
    if (!response.ok) {
      return { html: '', statusCode };
    }

    const html = await response.text();
    return { html, statusCode };
  } catch {
    // Network error, timeout, etc.
    return null;
  } finally {
    clearTimeout(timeoutId);
  }
}

// ---------------------------------------------------------------------------
// BFS Page Crawler
// ---------------------------------------------------------------------------

/**
 * Crawl pages starting from the session's seed URL using BFS traversal.
 *
 * This function:
 * 1. Starts from the initial URL at depth 0 (or resumes from a previous progress state)
 * 2. Extracts links from each page using cheerio
 * 3. Tracks visited URLs to avoid cycles
 * 4. Respects the depth limit from CrawlConfig
 * 5. Rate limits to 1 request/second per domain
 * 6. Follows pagination links (next/prev) within depth budget
 * 7. Persists crawl progress via onProgress callback for resumability
 *
 * @param session - An initialised CrawlSession (from initCrawlSession)
 * @param options - Optional configuration for fetch, progress callbacks, and resume state
 * @returns The updated CrawlSession with visitedUrls populated and crawledPages in results
 *
 * Requirements: 4.3, 4.6, 4.8, 4.10
 */
export async function crawlPages(
  session: CrawlSession,
  options: CrawlPagesOptions = {}
): Promise<CrawlSession & { crawledPages: CrawledPage[] }> {
  const { fetchFn = globalThis.fetch, onProgress, resumeFrom } = options;
  const { config } = session;
  const userAgent = DEFAULT_USER_AGENT;

  // Initialise BFS state — resume from checkpoint if provided
  const visited = new Set<string>(resumeFrom?.visitedUrls ?? session.visitedUrls);
  const crawledPages: CrawledPage[] = resumeFrom?.crawledPages ?? [];

  // Build the BFS queue: either resume from checkpoint or start fresh
  const queue: BfsQueueEntry[] = resumeFrom?.pendingQueue ?? buildInitialQueue(session, visited);

  // Process the BFS queue
  while (queue.length > 0) {
    const entry = queue.shift()!;
    const { url, depth } = entry;

    // Skip if already visited (may have been added multiple times before visit)
    if (visited.has(url)) {
      continue;
    }

    // Enforce depth limit
    if (depth > config.maxDepth) {
      continue;
    }

    // Get the domain for rate limiting
    let domain: string;
    try {
      domain = new URL(url).host;
    } catch {
      continue; // Skip invalid URLs
    }

    // Enforce rate limiting (1 req/sec per domain)
    await enforceRateLimit(domain, session);

    // Fetch the page
    const result = await fetchPage(url, userAgent, fetchFn);

    // Mark as visited regardless of success (avoid retrying failed pages)
    visited.add(url);

    if (result === null) {
      // Network failure — skip page, continue crawling (req 4.9 style handling)
      continue;
    }

    if (result.statusCode >= 400) {
      // HTTP error — log and skip page per requirement 4.9
      continue;
    }

    // Record the successfully crawled page
    const crawledPage: CrawledPage = {
      url,
      depth,
      html: result.html,
      statusCode: result.statusCode,
      fetchedAt: new Date().toISOString(),
    };
    crawledPages.push(crawledPage);

    // Extract links and add to queue if within depth budget
    if (depth < config.maxDepth) {
      const discoveredLinks = extractLinks(result.html, url);
      for (const link of discoveredLinks) {
        if (!visited.has(link)) {
          queue.push({ url: link, depth: depth + 1 });
        }
      }
    }

    // Update session state for persistence
    session.visitedUrls = Array.from(visited);
    session.pendingUrls = queue.map((e) => e.url);
    session.currentDepth = depth;
    session.updatedAt = new Date().toISOString();

    // Persist progress for resumability (requirement 4.10)
    if (onProgress) {
      const progress: CrawlProgress = {
        sessionId: session.sessionId,
        visitedUrls: Array.from(visited),
        pendingQueue: [...queue],
        crawledPages,
        updatedAt: session.updatedAt,
      };
      await onProgress(progress);
    }
  }

  // Mark session as completed
  session.visitedUrls = Array.from(visited);
  session.pendingUrls = [];
  session.completed = true;
  session.updatedAt = new Date().toISOString();

  return { ...session, crawledPages };
}

/**
 * Build the initial BFS queue from the session's pending URLs.
 * Used when not resuming from a checkpoint.
 */
function buildInitialQueue(session: CrawlSession, visited: Set<string>): BfsQueueEntry[] {
  return session.pendingUrls
    .filter((url) => !visited.has(url))
    .map((url) => ({ url, depth: 0 }));
}
