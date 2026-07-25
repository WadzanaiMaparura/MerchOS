import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { createAuthenticatedFetch } from '../api-client';

// Mock global fetch
const mockFetch = vi.fn();
vi.stubGlobal('fetch', mockFetch);

describe('createAuthenticatedFetch', () => {
  let getAccessToken: ReturnType<typeof vi.fn>;
  let onUnauthorized: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    getAccessToken = vi.fn().mockResolvedValue('test-access-token');
    onUnauthorized = vi.fn();
    mockFetch.mockReset();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('should attach Authorization header to requests', async () => {
    mockFetch.mockResolvedValueOnce(new Response('ok', { status: 200 }));

    const authenticatedFetch = createAuthenticatedFetch(getAccessToken, onUnauthorized);
    await authenticatedFetch('/api/data');

    expect(mockFetch).toHaveBeenCalledTimes(1);
    const [url, options] = mockFetch.mock.calls[0];
    expect(url).toBe('/api/data');
    expect(options.headers.get('Authorization')).toBe('Bearer test-access-token');
  });

  it('should prepend baseUrl when provided', async () => {
    mockFetch.mockResolvedValueOnce(new Response('ok', { status: 200 }));

    const authenticatedFetch = createAuthenticatedFetch(getAccessToken, onUnauthorized);
    await authenticatedFetch('/users', { baseUrl: 'https://api.example.com' });

    const [url] = mockFetch.mock.calls[0];
    expect(url).toBe('https://api.example.com/users');
  });

  it('should pass through custom headers and options', async () => {
    mockFetch.mockResolvedValueOnce(new Response('ok', { status: 200 }));

    const authenticatedFetch = createAuthenticatedFetch(getAccessToken, onUnauthorized);
    await authenticatedFetch('/api/data', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ key: 'value' }),
    });

    const [, options] = mockFetch.mock.calls[0];
    expect(options.method).toBe('POST');
    expect(options.headers.get('Content-Type')).toBe('application/json');
    expect(options.body).toBe(JSON.stringify({ key: 'value' }));
  });

  it('should return response directly on non-401 status', async () => {
    mockFetch.mockResolvedValueOnce(new Response('ok', { status: 200 }));

    const authenticatedFetch = createAuthenticatedFetch(getAccessToken, onUnauthorized);
    const response = await authenticatedFetch('/api/data');

    expect(response.status).toBe(200);
    expect(onUnauthorized).not.toHaveBeenCalled();
  });

  it('should retry with refreshed token on 401 response', async () => {
    // First call returns 401
    mockFetch.mockResolvedValueOnce(new Response('unauthorized', { status: 401 }));
    // Second call (retry) returns 200
    mockFetch.mockResolvedValueOnce(new Response('ok', { status: 200 }));

    // On second call to getAccessToken (refresh), return a new token
    getAccessToken.mockResolvedValueOnce('test-access-token').mockResolvedValueOnce('refreshed-token');

    const authenticatedFetch = createAuthenticatedFetch(getAccessToken, onUnauthorized);
    const response = await authenticatedFetch('/api/data');

    expect(response.status).toBe(200);
    expect(mockFetch).toHaveBeenCalledTimes(2);

    // Verify retry used refreshed token
    const [, retryOptions] = mockFetch.mock.calls[1];
    expect(retryOptions.headers.get('Authorization')).toBe('Bearer refreshed-token');
  });

  it('should call onUnauthorized when token refresh returns null', async () => {
    mockFetch.mockResolvedValueOnce(new Response('unauthorized', { status: 401 }));
    getAccessToken.mockResolvedValueOnce('test-access-token').mockResolvedValueOnce(null);

    const authenticatedFetch = createAuthenticatedFetch(getAccessToken, onUnauthorized);
    await authenticatedFetch('/api/data');

    expect(onUnauthorized).toHaveBeenCalledTimes(1);
    expect(mockFetch).toHaveBeenCalledTimes(1); // No retry
  });

  it('should call onUnauthorized when token refresh throws', async () => {
    mockFetch.mockResolvedValueOnce(new Response('unauthorized', { status: 401 }));
    getAccessToken.mockResolvedValueOnce('test-access-token').mockRejectedValueOnce(new Error('Refresh failed'));

    const authenticatedFetch = createAuthenticatedFetch(getAccessToken, onUnauthorized);
    await authenticatedFetch('/api/data');

    expect(onUnauthorized).toHaveBeenCalledTimes(1);
  });

  it('should not attach token when getAccessToken returns null', async () => {
    getAccessToken.mockResolvedValueOnce(null);
    mockFetch.mockResolvedValueOnce(new Response('ok', { status: 200 }));

    const authenticatedFetch = createAuthenticatedFetch(getAccessToken, onUnauthorized);
    await authenticatedFetch('/api/data');

    const [, options] = mockFetch.mock.calls[0];
    expect(options.headers.has('Authorization')).toBe(false);
  });
});
