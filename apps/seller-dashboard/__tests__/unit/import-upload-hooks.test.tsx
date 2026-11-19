/**
 * Browser side of supplier imports: stage -> PUT to S3 -> start.
 * The API client is faked through its React context; fetch (used for the S3 PUT) is stubbed.
 */
import React from 'react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { renderHook, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import {
  SupplierClientContext,
  useStartFileImport,
  useStartImageImport,
  useStartUrlImport,
  importContentType,
} from '@merch-os/api-client';

const post = vi.fn();
const fakeClient = { post } as never;
const fetchMock = vi.fn();

function wrapper({ children }: { children: React.ReactNode }) {
  const qc = new QueryClient({ defaultOptions: { mutations: { retry: false } } });
  return (
    <QueryClientProvider client={qc}>
      <SupplierClientContext.Provider value={fakeClient}>{children}</SupplierClientContext.Provider>
    </QueryClientProvider>
  );
}

const upload = (key: string, type = 'text/csv') => ({
  key,
  url: `https://raw.s3.eu-west-1.amazonaws.com/${key}?X-Amz-Signature=abc`,
  method: 'PUT',
  headers: { 'Content-Type': type },
  expiresAt: '2026-11-19T10:15:00.000Z',
});
const file = (name: string, type = '', size = 3) => new File(['x'.repeat(size)], name, { type });

beforeEach(() => {
  post.mockReset();
  fetchMock.mockReset().mockResolvedValue({ ok: true, status: 200 });
  vi.stubGlobal('fetch', fetchMock);
});
afterEach(() => vi.unstubAllGlobals());

describe('importContentType', () => {
  it.each([
    ['stock.CSV', '', 'text/csv'],
    ['stock.csv', 'application/vnd.ms-excel', 'text/csv'], // Windows reports CSV as Excel
    ['book.xlsx', '', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'],
    ['cat.pdf', '', 'application/pdf'],
    ['all.zip', 'application/x-zip-compressed', 'application/zip'],
    ['x.bin', 'application/octet-stream', 'application/octet-stream'],
  ])('%s (%s) -> %s', (name, type, expected) => {
    expect(importContentType(file(name, type))).toBe(expected);
  });
});

describe('useStartFileImport', () => {
  it('stages, uploads straight to S3 WITHOUT the API auth header, then starts', async () => {
    post
      .mockResolvedValueOnce({ data: { importJobId: 'j1', status: 'AWAITING_UPLOAD', uploads: [upload('k1')], startUrl: '/imports/j1/start' } })
      .mockResolvedValueOnce({ data: { importJobId: 'j1', status: 'QUEUED' } });
    const { result } = renderHook(() => useStartFileImport('sup-1'), { wrapper });
    const f = file('stock.csv', 'application/vnd.ms-excel', 5);
    result.current.mutate([f]);
    await waitFor(() => expect(result.current.isSuccess).toBe(true));

    expect(post.mock.calls[0]).toEqual([
      '/suppliers/sup-1/imports/file',
      { fileName: 'stock.csv', contentType: 'text/csv', fileSizeBytes: 5 },
    ]);
    const [url, init] = fetchMock.mock.calls[0]!;
    expect(url).toContain('X-Amz-Signature');
    expect(init.method).toBe('PUT');
    expect(init.body).toBe(f);
    expect(init.headers).toEqual({ 'Content-Type': 'text/csv' }); // no Authorization
    expect(post.mock.calls[1]![0]).toBe('/imports/j1/start');
    expect(result.current.data).toEqual([{ importJobId: 'j1', status: 'QUEUED' }]);
  });

  it('never calls start when the S3 upload fails, and says why', async () => {
    post.mockResolvedValueOnce({ data: { importJobId: 'j1', uploads: [upload('k1')], startUrl: '/imports/j1/start' } });
    fetchMock.mockResolvedValue({ ok: false, status: 403 });
    const { result } = renderHook(() => useStartFileImport('sup-1'), { wrapper });
    result.current.mutate([file('a.csv')]);
    await waitFor(() => expect(result.current.isError).toBe(true));
    expect(post).toHaveBeenCalledTimes(1);
    expect(result.current.error?.message).toMatch(/expired/);
  });

  it('a network failure during upload is reported, not swallowed', async () => {
    post.mockResolvedValueOnce({ data: { importJobId: 'j1', uploads: [upload('k1')], startUrl: '/imports/j1/start' } });
    fetchMock.mockRejectedValue(new TypeError('Failed to fetch'));
    const { result } = renderHook(() => useStartFileImport('sup-1'), { wrapper });
    result.current.mutate([file('a.csv')]);
    await waitFor(() => expect(result.current.isError).toBe(true));
    expect(result.current.error?.code).toBe('UPLOAD_FAILED');
  });

  it('starts one import per file', async () => {
    post
      .mockResolvedValueOnce({ data: { importJobId: 'a', uploads: [upload('ka')], startUrl: '/imports/a/start' } })
      .mockResolvedValueOnce({ data: { importJobId: 'a', status: 'QUEUED' } })
      .mockResolvedValueOnce({ data: { importJobId: 'b', uploads: [upload('kb')], startUrl: '/imports/b/start' } })
      .mockResolvedValueOnce({ data: { importJobId: 'b', status: 'QUEUED' } });
    const { result } = renderHook(() => useStartFileImport('sup-1'), { wrapper });
    result.current.mutate([file('a.csv'), file('b.csv')]);
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(result.current.data!.map((s) => s.importJobId)).toEqual(['a', 'b']);
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });
});

describe('useStartImageImport', () => {
  it('sends all images as ONE job, uploads each to its own URL, then starts once', async () => {
    post
      .mockResolvedValueOnce({
        data: { importJobId: 'j9', uploads: [upload('k1', 'image/png'), upload('k2', 'image/jpeg')], startUrl: '/imports/j9/start' },
      })
      .mockResolvedValueOnce({ data: { importJobId: 'j9', status: 'QUEUED' } });
    const { result } = renderHook(() => useStartImageImport('sup-1'), { wrapper });
    const a = file('a.png', 'image/png');
    const b = file('b.jpg', 'image/jpeg');
    result.current.mutate([a, b]);
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(post.mock.calls[0]![1]).toEqual({
      images: [
        { fileName: 'a.png', contentType: 'image/png', fileSizeBytes: 3 },
        { fileName: 'b.jpg', contentType: 'image/jpeg', fileSizeBytes: 3 },
      ],
    });
    expect(fetchMock.mock.calls.map((c) => c[1].body)).toEqual([a, b]);
    expect(post).toHaveBeenCalledTimes(2);
  });
});

describe('useStartUrlImport', () => {
  it('posts the URL; no upload step', async () => {
    post.mockResolvedValueOnce({ data: { importJobId: 'u1', status: 'QUEUED' } });
    const { result } = renderHook(() => useStartUrlImport('sup 1'), { wrapper });
    result.current.mutate({ url: 'https://supplier.example/products' });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(post).toHaveBeenCalledWith('/suppliers/sup%201/imports/url', { url: 'https://supplier.example/products' });
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
