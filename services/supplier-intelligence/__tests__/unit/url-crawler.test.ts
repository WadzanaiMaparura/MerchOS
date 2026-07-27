/**
 * Unit tests for the URL crawler — robots.txt parsing and permission checking.
 * Requirements: 4.1, 4.2, 4.13
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import {
  checkRobotsPermission,
  fetchRobotsTxt,
  getRobotsTxtUrl,
  DEFAULT_USER_AGENT,
} from '../../processors/url-crawler';

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
