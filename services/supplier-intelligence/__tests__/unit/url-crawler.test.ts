/**
 * Unit tests for the URL crawler — robots.txt parsing, permission checking,
 * and BFS page crawling with depth limit and rate limiting.
 * Requirements: 4.1, 4.2, 4.3, 4.6, 4.8, 4.10, 4.13
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import {
  checkRobotsPermission,
  fetchRobotsTxt,
  getRobotsTxtUrl,
  DEFAULT_USER_AGENT,
  extractLinks,
  crawlPages,
  type CrawlPagesOptions,
  type CrawlProgress,
  type CrawledPage,
} from '../../processors/url-crawler';
import type { CrawlSession } from '../../types/crawl.types';

// ---------------------------------------------------------------------------
// getRobotsTxtUrl
// ---------------------------------------------------------------------------

describe('getRobotsTxtUrl', () => {
  it('constructs robots.txt URL from an HTTPS URL', () => {
    expect(getRobotsTxtUrl('https://example.com/products/shoes')).toBe(
      'https://example.com/robots.txt'
    );
  });

  it('constructs robots.txt URL from an HTTP URL', () => {
    expect(getRobotsTxtUrl('http://shop.example.org/catalog')).toBe(
      'http://shop.example.org/robots.txt'
    );
  });

  it('preserves port in the robots.txt URL', () => {
    expect(getRobotsTxtUrl('https://example.com:8080/products')).toBe(
      'https://example.com:8080/robots.txt'
    );
  });

  it('handles URLs with query parameters and fragments', () => {
    expect(getRobotsTxtUrl('https://example.com/page?q=test#section')).toBe(
      'https://example.com/robots.txt'
    );
  });
});

// ---------------------------------------------------------------------------
// checkRobotsPermission
// ---------------------------------------------------------------------------

describe('checkRobotsPermission', () => {
  const mockFetch = vi.fn();

  beforeEach(() => {
    vi.stubGlobal('fetch', mockFetch);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it('returns allowed: true when robots.txt is not found (404)', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: false,
      status: 404,
      statusText: 'Not Found',
    });

    const result = await checkRobotsPermission('https://example.com/products');

    expect(result.allowed).toBe(true);
    expect(result.reason).toBeUndefined();
  });

  it('returns allowed: true when robots.txt allows the path', async () => {
    const robotsTxt = [
      'User-agent: *',
      'Allow: /products',
      'Disallow: /admin',
    ].join('\n');

    mockFetch.mockResolvedValueOnce({
      ok: true,
      status: 200,
      text: async () => robotsTxt,
    });

    const result = await checkRobotsPermission('https://example.com/products/shoes');

    expect(result.allowed).toBe(true);
    expect(result.reason).toBeUndefined();
  });

  it('returns allowed: false when robots.txt disallows the path', async () => {
    const robotsTxt = [
      'User-agent: *',
      'Disallow: /products',
    ].join('\n');

    mockFetch.mockResolvedValueOnce({
      ok: true,
      status: 200,
      text: async () => robotsTxt,
    });

    const result = await checkRobotsPermission('https://example.com/products/shoes');

    expect(result.allowed).toBe(false);
    expect(result.reason).toContain('does not permit automated data collection');
    expect(result.reason).toContain('/products/shoes');
  });

  it('returns allowed: true when robots.txt has no matching rules', async () => {
    const robotsTxt = [
      'User-agent: Googlebot',
      'Disallow: /',
    ].join('\n');

    mockFetch.mockResolvedValueOnce({
      ok: true,
      status: 200,
      text: async () => robotsTxt,
    });

    const result = await checkRobotsPermission('https://example.com/products');

    expect(result.allowed).toBe(true);
  });

  it('returns allowed: false when all paths are disallowed', async () => {
    const robotsTxt = [
      'User-agent: *',
      'Disallow: /',
    ].join('\n');

    mockFetch.mockResolvedValueOnce({
      ok: true,
      status: 200,
      text: async () => robotsTxt,
    });

    const result = await checkRobotsPermission('https://example.com/anything');

    expect(result.allowed).toBe(false);
    expect(result.reason).toContain('robots.txt');
  });

  it('includes crawlDelay when specified in robots.txt', async () => {
    const robotsTxt = [
      'User-agent: *',
      'Crawl-delay: 5',
      'Allow: /',
    ].join('\n');

    mockFetch.mockResolvedValueOnce({
      ok: true,
      status: 200,
      text: async () => robotsTxt,
    });

    const result = await checkRobotsPermission('https://example.com/products');

    expect(result.allowed).toBe(true);
    expect(result.crawlDelay).toBe(5);
  });

  it('returns allowed: false when fetch fails with network error', async () => {
    mockFetch.mockRejectedValueOnce(new Error('Network timeout'));

    const result = await checkRobotsPermission('https://unreachable.example.com/products');

    expect(result.allowed).toBe(false);
    expect(result.reason).toContain('Unable to verify crawl permissions');
    expect(result.reason).toContain('Network timeout');
  });

  it('returns allowed: false when fetch returns 5xx error', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: false,
      status: 500,
      statusText: 'Internal Server Error',
    });

    const result = await checkRobotsPermission('https://example.com/products');

    expect(result.allowed).toBe(false);
    expect(result.reason).toContain('Unable to verify crawl permissions');
  });

  it('returns allowed: false for invalid URL', async () => {
    const result = await checkRobotsPermission('not-a-url');

    expect(result.allowed).toBe(false);
    expect(result.reason).toContain('Invalid URL');
  });

  it('returns allowed: false for unsupported protocol', async () => {
    const result = await checkRobotsPermission('ftp://files.example.com/catalog');

    expect(result.allowed).toBe(false);
    expect(result.reason).toContain('Unsupported protocol');
    expect(result.reason).toContain('ftp:');
  });

  it('uses the default user-agent when none is specified', async () => {
    const robotsTxt = [
      `User-agent: ${DEFAULT_USER_AGENT}`,
      'Disallow: /restricted',
      'User-agent: *',
      'Allow: /',
    ].join('\n');

    mockFetch.mockResolvedValueOnce({
      ok: true,
      status: 200,
      text: async () => robotsTxt,
    });

    const result = await checkRobotsPermission('https://example.com/restricted');

    expect(result.allowed).toBe(false);
  });

  it('respects a custom user-agent parameter', async () => {
    const robotsTxt = [
      'User-agent: CustomBot',
      'Disallow: /',
      'User-agent: *',
      'Allow: /',
    ].join('\n');

    mockFetch.mockResolvedValueOnce({
      ok: true,
      status: 200,
      text: async () => robotsTxt,
    });

    const result = await checkRobotsPermission('https://example.com/products', 'CustomBot');

    expect(result.allowed).toBe(false);
  });

  it('sends the correct user-agent header in the fetch request', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: false,
      status: 404,
      statusText: 'Not Found',
    });

    await checkRobotsPermission('https://example.com/products');

    expect(mockFetch).toHaveBeenCalledWith(
      'https://example.com/robots.txt',
      expect.objectContaining({
        headers: { 'User-Agent': DEFAULT_USER_AGENT },
      })
    );
  });
});

// ---------------------------------------------------------------------------
// fetchRobotsTxt
// ---------------------------------------------------------------------------

describe('fetchRobotsTxt', () => {
  const mockFetch = vi.fn();

  beforeEach(() => {
    vi.stubGlobal('fetch', mockFetch);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it('returns content when fetch is successful', async () => {
    const content = 'User-agent: *\nAllow: /';
    mockFetch.mockResolvedValueOnce({
      ok: true,
      status: 200,
      text: async () => content,
    });

    const result = await fetchRobotsTxt('https://example.com/robots.txt');
    expect(result).toBe(content);
  });

  it('returns null when robots.txt is not found (404)', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: false,
      status: 404,
      statusText: 'Not Found',
    });

    const result = await fetchRobotsTxt('https://example.com/robots.txt');
    expect(result).toBeNull();
  });

  it('throws error on non-404 HTTP errors', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: false,
      status: 503,
      statusText: 'Service Unavailable',
    });

    await expect(fetchRobotsTxt('https://example.com/robots.txt')).rejects.toThrow(
      'Failed to fetch robots.txt: HTTP 503 Service Unavailable'
    );
  });

  it('throws error on network failure', async () => {
    mockFetch.mockRejectedValueOnce(new Error('ECONNREFUSED'));

    await expect(fetchRobotsTxt('https://example.com/robots.txt')).rejects.toThrow(
      'ECONNREFUSED'
    );
  });
});


// ---------------------------------------------------------------------------
// extractLinks
// ---------------------------------------------------------------------------

describe('extractLinks', () => {
  it('extracts same-origin anchor links', () => {
    const html = `
      <html><body>
        <a href="/products/shoes">Shoes</a>
        <a href="/products/hats">Hats</a>
      </body></html>
    `;
    const links = extractLinks(html, 'https://example.com/catalog');
    expect(links).toContain('https://example.com/products/shoes');
    expect(links).toContain('https://example.com/products/hats');
  });

  it('resolves relative URLs against the page URL', () => {
    const html = `<html><body><a href="./page2">Next</a></body></html>`;
    const links = extractLinks(html, 'https://example.com/catalog/page1');
    expect(links).toContain('https://example.com/catalog/page2');
  });

  it('excludes cross-origin links', () => {
    const html = `
      <html><body>
        <a href="https://other-domain.com/products">External</a>
        <a href="/local">Local</a>
      </body></html>
    `;
    const links = extractLinks(html, 'https://example.com/page');
    expect(links).not.toContain('https://other-domain.com/products');
    expect(links).toContain('https://example.com/local');
  });

  it('excludes javascript:, mailto:, and tel: links', () => {
    const html = `
      <html><body>
        <a href="javascript:void(0)">JS</a>
        <a href="mailto:test@example.com">Email</a>
        <a href="tel:+1234567890">Phone</a>
        <a href="/valid">Valid</a>
      </body></html>
    `;
    const links = extractLinks(html, 'https://example.com/page');
    expect(links).toHaveLength(1);
    expect(links[0]).toBe('https://example.com/valid');
  });

  it('extracts pagination links from <link rel="next">', () => {
    const html = `
      <html><head>
        <link rel="next" href="/catalog?page=2" />
        <link rel="prev" href="/catalog?page=0" />
      </head><body></body></html>
    `;
    const links = extractLinks(html, 'https://example.com/catalog?page=1');
    expect(links).toContain('https://example.com/catalog?page=2');
    expect(links).toContain('https://example.com/catalog?page=0');
  });

  it('extracts pagination links from <a rel="next">', () => {
    const html = `
      <html><body>
        <a rel="next" href="/page/3">Next Page</a>
      </body></html>
    `;
    const links = extractLinks(html, 'https://example.com/page/2');
    expect(links).toContain('https://example.com/page/3');
  });

  it('deduplicates identical URLs', () => {
    const html = `
      <html><body>
        <a href="/products">Products</a>
        <a href="/products">Products Again</a>
      </body></html>
    `;
    const links = extractLinks(html, 'https://example.com/');
    const productLinks = links.filter((l) => l === 'https://example.com/products');
    expect(productLinks).toHaveLength(1);
  });

  it('strips fragment identifiers from URLs', () => {
    const html = `<html><body><a href="/page#section1">Link</a></body></html>`;
    const links = extractLinks(html, 'https://example.com/');
    expect(links).toContain('https://example.com/page');
    expect(links.some((l) => l.includes('#'))).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// crawlPages — BFS traversal
// ---------------------------------------------------------------------------

describe('crawlPages', () => {
  function createMockSession(overrides: Partial<CrawlSession> = {}): CrawlSession {
    return {
      sessionId: 'test-session-id',
      importJobId: 'import-123',
      tenantId: 'tenant-abc',
      supplierId: 'supplier-xyz',
      seedUrl: 'https://example.com/',
      config: {
        maxDepth: 2,
        rateLimit: 1000, // High rate for fast tests (1000 req/sec = no meaningful delay)
        circuitBreakerThreshold: 5,
        circuitBreakerPauseMs: 120_000,
        resumable: true,
      },
      visitedUrls: [],
      pendingUrls: ['https://example.com/'],
      currentDepth: 0,
      circuitBreakerStates: { 'example.com': 'CLOSED' },
      consecutiveFailures: { 'example.com': 0 },
      lastRequestTime: {},
      completed: false,
      startedAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      ...overrides,
    };
  }

  function createMockFetch(pages: Record<string, string>): typeof fetch {
    return async (input: RequestInfo | URL, _init?: RequestInit) => {
      const url = typeof input === 'string' ? input : input.toString();
      const html = pages[url];
      if (html !== undefined) {
        return {
          ok: true,
          status: 200,
          text: async () => html,
        } as Response;
      }
      return {
        ok: false,
        status: 404,
        text: async () => '',
      } as Response;
    };
  }

  it('crawls seed URL at depth 0 and returns crawled page', async () => {
    const pages: Record<string, string> = {
      'https://example.com/': '<html><body><h1>Home</h1></body></html>',
    };
    const session = createMockSession();
    const result = await crawlPages(session, { fetchFn: createMockFetch(pages) });

    expect(result.crawledPages).toHaveLength(1);
    expect(result.crawledPages[0].url).toBe('https://example.com/');
    expect(result.crawledPages[0].depth).toBe(0);
    expect(result.crawledPages[0].html).toContain('<h1>Home</h1>');
    expect(result.completed).toBe(true);
  });

  it('follows links up to the configured depth limit', async () => {
    const pages: Record<string, string> = {
      'https://example.com/': '<html><body><a href="/level1">L1</a></body></html>',
      'https://example.com/level1': '<html><body><a href="/level2">L2</a></body></html>',
      'https://example.com/level2': '<html><body><a href="/level3">L3</a></body></html>',
      'https://example.com/level3': '<html><body><p>Too deep</p></body></html>',
    };
    const session = createMockSession({ config: { ...createMockSession().config, maxDepth: 2 } });
    const result = await crawlPages(session, { fetchFn: createMockFetch(pages) });

    const visitedUrls = result.crawledPages.map((p) => p.url);
    expect(visitedUrls).toContain('https://example.com/');
    expect(visitedUrls).toContain('https://example.com/level1');
    expect(visitedUrls).toContain('https://example.com/level2');
    // level3 is at depth 3, should NOT be visited with maxDepth: 2
    expect(visitedUrls).not.toContain('https://example.com/level3');
  });

  it('does not visit pages beyond depth limit', async () => {
    const pages: Record<string, string> = {
      'https://example.com/': '<html><body><a href="/a">A</a></body></html>',
      'https://example.com/a': '<html><body><a href="/b">B</a></body></html>',
      'https://example.com/b': '<html><body><a href="/c">C</a></body></html>',
    };
    const session = createMockSession({ config: { ...createMockSession().config, maxDepth: 1 } });
    const result = await crawlPages(session, { fetchFn: createMockFetch(pages) });

    const visitedUrls = result.crawledPages.map((p) => p.url);
    expect(visitedUrls).toContain('https://example.com/');
    expect(visitedUrls).toContain('https://example.com/a');
    // /b is at depth 2, beyond maxDepth: 1
    expect(visitedUrls).not.toContain('https://example.com/b');
  });

  it('avoids revisiting already visited URLs (cycle detection)', async () => {
    const pages: Record<string, string> = {
      'https://example.com/': '<html><body><a href="/page1">P1</a></body></html>',
      'https://example.com/page1': '<html><body><a href="/">Back to home</a></body></html>',
    };
    const session = createMockSession();
    const result = await crawlPages(session, { fetchFn: createMockFetch(pages) });

    // Home page should only be visited once, even though page1 links back to it
    const homeVisits = result.crawledPages.filter((p) => p.url === 'https://example.com/');
    expect(homeVisits).toHaveLength(1);
    expect(result.crawledPages).toHaveLength(2);
  });

  it('follows pagination links within depth budget', async () => {
    const pages: Record<string, string> = {
      'https://example.com/products': `
        <html>
        <head><link rel="next" href="/products?page=2" /></head>
        <body><p>Page 1</p></body>
        </html>
      `,
      'https://example.com/products?page=2': `
        <html>
        <head><link rel="next" href="/products?page=3" /></head>
        <body><p>Page 2</p></body>
        </html>
      `,
      'https://example.com/products?page=3': `
        <html><body><p>Page 3</p></body></html>
      `,
    };
    const session = createMockSession({
      seedUrl: 'https://example.com/products',
      pendingUrls: ['https://example.com/products'],
      config: { ...createMockSession().config, maxDepth: 3 },
    });
    const result = await crawlPages(session, { fetchFn: createMockFetch(pages) });

    const visitedUrls = result.crawledPages.map((p) => p.url);
    expect(visitedUrls).toContain('https://example.com/products');
    expect(visitedUrls).toContain('https://example.com/products?page=2');
    expect(visitedUrls).toContain('https://example.com/products?page=3');
  });

  it('skips pages that return HTTP errors', async () => {
    const mockFetch = async (input: RequestInfo | URL, _init?: RequestInit) => {
      const url = typeof input === 'string' ? input : input.toString();
      if (url === 'https://example.com/') {
        return {
          ok: true,
          status: 200,
          text: async () => '<html><body><a href="/broken">Broken</a><a href="/ok">OK</a></body></html>',
        } as Response;
      }
      if (url === 'https://example.com/broken') {
        return { ok: false, status: 500, text: async () => '' } as Response;
      }
      if (url === 'https://example.com/ok') {
        return { ok: true, status: 200, text: async () => '<html><body>OK</body></html>' } as Response;
      }
      return { ok: false, status: 404, text: async () => '' } as Response;
    };

    const session = createMockSession();
    const result = await crawlPages(session, { fetchFn: mockFetch as typeof fetch });

    // The broken page is visited (marked visited) but not in crawledPages since it returned 500
    const crawledUrls = result.crawledPages.map((p) => p.url);
    expect(crawledUrls).toContain('https://example.com/');
    expect(crawledUrls).toContain('https://example.com/ok');
    expect(crawledUrls).not.toContain('https://example.com/broken');
  });

  it('skips pages when network fetch fails', async () => {
    const mockFetch = async (input: RequestInfo | URL, _init?: RequestInit) => {
      const url = typeof input === 'string' ? input : input.toString();
      if (url === 'https://example.com/') {
        return {
          ok: true,
          status: 200,
          text: async () => '<html><body><a href="/timeout">Timeout</a></body></html>',
        } as Response;
      }
      throw new Error('ECONNREFUSED');
    };

    const session = createMockSession();
    const result = await crawlPages(session, { fetchFn: mockFetch as typeof fetch });

    expect(result.crawledPages).toHaveLength(1);
    expect(result.crawledPages[0].url).toBe('https://example.com/');
    expect(result.completed).toBe(true);
  });

  it('calls onProgress callback after each page (resumability)', async () => {
    const pages: Record<string, string> = {
      'https://example.com/': '<html><body><a href="/page2">P2</a></body></html>',
      'https://example.com/page2': '<html><body><p>Page 2</p></body></html>',
    };
    const progressUpdates: CrawlProgress[] = [];
    const onProgress = (progress: CrawlProgress) => {
      progressUpdates.push(structuredClone(progress));
    };

    const session = createMockSession();
    await crawlPages(session, { fetchFn: createMockFetch(pages), onProgress });

    expect(progressUpdates.length).toBeGreaterThanOrEqual(2);
    // First progress update should show the seed URL as visited
    expect(progressUpdates[0].visitedUrls).toContain('https://example.com/');
    // Second update should also show page2 as visited
    expect(progressUpdates[1].visitedUrls).toContain('https://example.com/page2');
  });

  it('can resume from a previous crawl progress state', async () => {
    const pages: Record<string, string> = {
      'https://example.com/': '<html><body><a href="/page2">P2</a></body></html>',
      'https://example.com/page2': '<html><body><a href="/page3">P3</a></body></html>',
      'https://example.com/page3': '<html><body><p>Page 3</p></body></html>',
    };

    // Simulate a previous crawl that completed the first page only
    const previousProgress: CrawlProgress = {
      sessionId: 'test-session-id',
      visitedUrls: ['https://example.com/'],
      pendingQueue: [{ url: 'https://example.com/page2', depth: 1 }],
      crawledPages: [
        {
          url: 'https://example.com/',
          depth: 0,
          html: '<html><body><a href="/page2">P2</a></body></html>',
          statusCode: 200,
          fetchedAt: new Date().toISOString(),
        },
      ],
      updatedAt: new Date().toISOString(),
    };

    const session = createMockSession({ config: { ...createMockSession().config, maxDepth: 3 } });
    const result = await crawlPages(session, {
      fetchFn: createMockFetch(pages),
      resumeFrom: previousProgress,
    });

    // Should NOT re-crawl the seed URL
    const homeCrawls = result.crawledPages.filter((p) => p.url === 'https://example.com/');
    expect(homeCrawls).toHaveLength(1); // Only the one from the resume state

    // Should have crawled page2 and page3
    const crawledUrls = result.crawledPages.map((p) => p.url);
    expect(crawledUrls).toContain('https://example.com/page2');
    expect(crawledUrls).toContain('https://example.com/page3');
    expect(result.completed).toBe(true);
  });

  it('marks session as completed when queue is exhausted', async () => {
    const pages: Record<string, string> = {
      'https://example.com/': '<html><body><p>Only page</p></body></html>',
    };
    const session = createMockSession();
    const result = await crawlPages(session, { fetchFn: createMockFetch(pages) });

    expect(result.completed).toBe(true);
    expect(result.pendingUrls).toHaveLength(0);
  });

  it('updates session visitedUrls with all crawled URLs', async () => {
    const pages: Record<string, string> = {
      'https://example.com/': '<html><body><a href="/a">A</a><a href="/b">B</a></body></html>',
      'https://example.com/a': '<html><body>A</body></html>',
      'https://example.com/b': '<html><body>B</body></html>',
    };
    const session = createMockSession();
    const result = await crawlPages(session, { fetchFn: createMockFetch(pages) });

    expect(result.visitedUrls).toContain('https://example.com/');
    expect(result.visitedUrls).toContain('https://example.com/a');
    expect(result.visitedUrls).toContain('https://example.com/b');
  });

  it('enforces rate limiting between requests', async () => {
    const timestamps: number[] = [];
    const mockFetch = async (input: RequestInfo | URL, _init?: RequestInit) => {
      timestamps.push(Date.now());
      const url = typeof input === 'string' ? input : input.toString();
      if (url === 'https://example.com/') {
        return {
          ok: true,
          status: 200,
          text: async () => '<html><body><a href="/page2">P2</a></body></html>',
        } as Response;
      }
      return { ok: true, status: 200, text: async () => '<html><body>End</body></html>' } as Response;
    };

    // Use rate limit of 1 req/sec (1000ms between requests)
    const session = createMockSession({
      config: { ...createMockSession().config, rateLimit: 1 },
    });
    await crawlPages(session, { fetchFn: mockFetch as typeof fetch });

    // Should have at least 2 requests, with ~1000ms gap between them
    expect(timestamps.length).toBeGreaterThanOrEqual(2);
    const gap = timestamps[1] - timestamps[0];
    // Allow some tolerance (950ms minimum to account for timer precision)
    expect(gap).toBeGreaterThanOrEqual(950);
  });
});
