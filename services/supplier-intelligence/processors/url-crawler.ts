/**
 * URL Crawler — robots.txt parsing, permission checking, and URL import entry point.
 * Requirements: 4.1, 4.2, 4.13
 *
 * Responsibilities:
 * - Fetch and parse robots.txt from target domains
 * - Check whether a given URL path is allowed for crawling
 * - Reject crawl if target path is disallowed with a user-friendly message
 * - Initialise a CrawlSession for BFS traversal when crawling is permitted
 * - Provide the entry point for URL-based imports (extended in tasks 7.2-7.5)
 *
 * Design decisions:
 * - Default user-agent: 'MerchOS-Crawler/1.0'
 * - If robots.txt is not found (404), assume all paths are allowed
 * - If robots.txt fetch fails for other reasons (network error, 5xx), treat as disallowed
 *   to comply with requirement 4.13 (do not bypass access restrictions)
 * - Module is designed for extensibility — BFS crawl, product extraction, circuit breaker,
 *   and stats recording will be added in subsequent tasks
 */

import robotsParser from 'robots-parser';
import { randomUUID } from 'node:crypto';
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
