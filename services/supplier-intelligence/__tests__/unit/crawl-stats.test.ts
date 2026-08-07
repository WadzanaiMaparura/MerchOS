import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
  CrawlStatsRecorder,
  deepEqual,
  diffProductFields,
  performIncrementalImport,
  setDynamoDocClient,
  type ExtractedProduct,
} from '../../utils/crawl-stats';

// ---------------------------------------------------------------------------
// CrawlStatsRecorder
// ---------------------------------------------------------------------------

describe('CrawlStatsRecorder', () => {
  let recorder: CrawlStatsRecorder;

  beforeEach(() => {
    recorder = new CrawlStatsRecorder();
  });

  describe('startSession / endSession lifecycle', () => {
    it('starts a session and records zero stats initially', () => {
      recorder.startSession();
      expect(recorder.isActive()).toBe(true);

      const snapshot = recorder.getSnapshot();
      expect(snapshot.pagesCrawled).toBe(0);
      expect(snapshot.pagesSkipped).toBe(0);
      expect(snapshot.productsExtracted).toBe(0);
      expect(snapshot.imagesDownloaded).toBe(0);
      expect(snapshot.errorsEncountered).toBe(0);
      expect(snapshot.durationMs).toBeGreaterThanOrEqual(0);
    });

    it('endSession returns final stats and deactivates the session', () => {
      recorder.startSession();
      recorder.recordPageCrawled(3);
      recorder.recordPageSkipped(2);
      recorder.recordProductExtracted(5);
      recorder.recordImageDownloaded(4);
      recorder.recordError(1);

      const stats = recorder.endSession();

      expect(stats.pagesCrawled).toBe(3);
      expect(stats.pagesSkipped).toBe(2);
      expect(stats.productsExtracted).toBe(5);
      expect(stats.imagesDownloaded).toBe(4);
      expect(stats.errorsEncountered).toBe(1);
      expect(stats.durationMs).toBeGreaterThanOrEqual(0);
      expect(recorder.isActive()).toBe(false);
    });

    it('throws if startSession is called while session is active', () => {
      recorder.startSession();
      expect(() => recorder.startSession()).toThrow(
        'A crawl stats session is already active'
      );
    });

    it('throws if endSession is called without an active session', () => {
      expect(() => recorder.endSession()).toThrow(
        'No active crawl stats session'
      );
    });

    it('allows starting a new session after previous session ends', () => {
      recorder.startSession();
      recorder.recordPageCrawled(10);
      recorder.endSession();

      recorder.startSession();
      const snapshot = recorder.getSnapshot();
      expect(snapshot.pagesCrawled).toBe(0);
    });
  });

  describe('stat recording methods', () => {
    beforeEach(() => {
      recorder.startSession();
    });

    it('recordPageCrawled increments by count', () => {
      recorder.recordPageCrawled();
      recorder.recordPageCrawled(4);
      expect(recorder.getSnapshot().pagesCrawled).toBe(5);
    });

    it('recordPageSkipped increments by count', () => {
      recorder.recordPageSkipped(3);
      expect(recorder.getSnapshot().pagesSkipped).toBe(3);
    });

    it('recordProductExtracted increments by count', () => {
      recorder.recordProductExtracted(10);
      expect(recorder.getSnapshot().productsExtracted).toBe(10);
    });

    it('recordImageDownloaded increments by count', () => {
      recorder.recordImageDownloaded(7);
      expect(recorder.getSnapshot().imagesDownloaded).toBe(7);
    });

    it('recordError increments by count', () => {
      recorder.recordError(2);
      recorder.recordError();
      expect(recorder.getSnapshot().errorsEncountered).toBe(3);
    });

    it('throws when recording stats without active session', () => {
      recorder.endSession();
      expect(() => recorder.recordPageCrawled()).toThrow('No active crawl stats session');
      expect(() => recorder.recordPageSkipped()).toThrow('No active crawl stats session');
      expect(() => recorder.recordProductExtracted()).toThrow('No active crawl stats session');
      expect(() => recorder.recordImageDownloaded()).toThrow('No active crawl stats session');
      expect(() => recorder.recordError()).toThrow('No active crawl stats session');
    });
  });

  describe('getSnapshot', () => {
    it('returns current stats without ending session', () => {
      recorder.startSession();
      recorder.recordPageCrawled(2);
      recorder.recordProductExtracted(1);

      const snapshot = recorder.getSnapshot();
      expect(snapshot.pagesCrawled).toBe(2);
      expect(snapshot.productsExtracted).toBe(1);

      // Session should still be active
      expect(recorder.isActive()).toBe(true);

      // Can continue recording
      recorder.recordPageCrawled(1);
      expect(recorder.getSnapshot().pagesCrawled).toBe(3);
    });

    it('throws when no session is active', () => {
      expect(() => recorder.getSnapshot()).toThrow('No active crawl stats session');
    });
  });

  describe('duration tracking', () => {
    it('tracks elapsed time from session start', async () => {
      recorder.startSession();

      // Wait a small amount to ensure duration > 0
      await new Promise((resolve) => setTimeout(resolve, 10));

      const stats = recorder.endSession();
      expect(stats.durationMs).toBeGreaterThanOrEqual(10);
    });
  });
});

// ---------------------------------------------------------------------------
// deepEqual
// ---------------------------------------------------------------------------

describe('deepEqual', () => {
  it('returns true for identical primitives', () => {
    expect(deepEqual(1, 1)).toBe(true);
    expect(deepEqual('hello', 'hello')).toBe(true);
    expect(deepEqual(true, true)).toBe(true);
    expect(deepEqual(null, null)).toBe(true);
  });

  it('returns false for different primitives', () => {
    expect(deepEqual(1, 2)).toBe(false);
    expect(deepEqual('a', 'b')).toBe(false);
    expect(deepEqual(true, false)).toBe(false);
  });

  it('handles null and undefined', () => {
    expect(deepEqual(null, undefined)).toBe(false);
    expect(deepEqual(undefined, null)).toBe(false);
    expect(deepEqual(undefined, undefined)).toBe(true);
  });

  it('compares arrays deeply', () => {
    expect(deepEqual([1, 2, 3], [1, 2, 3])).toBe(true);
    expect(deepEqual([1, 2], [1, 2, 3])).toBe(false);
    expect(deepEqual(['a', 'b'], ['a', 'c'])).toBe(false);
  });

  it('compares objects deeply', () => {
    expect(deepEqual({ a: 1, b: 2 }, { a: 1, b: 2 })).toBe(true);
    expect(deepEqual({ a: 1 }, { a: 2 })).toBe(false);
    expect(deepEqual({ a: 1 }, { a: 1, b: 2 })).toBe(false);
  });

  it('handles nested structures', () => {
    const a = { x: [1, { y: 'z' }] };
    const b = { x: [1, { y: 'z' }] };
    const c = { x: [1, { y: 'w' }] };
    expect(deepEqual(a, b)).toBe(true);
    expect(deepEqual(a, c)).toBe(false);
  });

  it('handles type mismatches', () => {
    expect(deepEqual(1, '1')).toBe(false);
    expect(deepEqual([], {})).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// diffProductFields
// ---------------------------------------------------------------------------

describe('diffProductFields', () => {
  it('returns empty array when no fields differ', () => {
    const existing = { title: 'Widget', price: 9.99, brand: 'Acme' };
    const extracted: ExtractedProduct = {
      sku: 'WDG-001',
      title: 'Widget',
      price: 9.99,
      brand: 'Acme',
    };

    const changed = diffProductFields(existing, extracted);
    expect(changed).toEqual([]);
  });

  it('detects changed primitive fields', () => {
    const existing = { title: 'Widget', price: 9.99, brand: 'Acme' };
    const extracted: ExtractedProduct = {
      sku: 'WDG-001',
      title: 'Widget Pro',
      price: 14.99,
      brand: 'Acme',
    };

    const changed = diffProductFields(existing, extracted);
    expect(changed).toContain('title');
    expect(changed).toContain('price');
    expect(changed).not.toContain('brand');
  });

  it('detects changed array fields (images)', () => {
    const existing = { images: ['img1.jpg', 'img2.jpg'] };
    const extracted: ExtractedProduct = {
      sku: 'WDG-001',
      images: ['img1.jpg', 'img3.jpg'],
    };

    const changed = diffProductFields(existing, extracted);
    expect(changed).toContain('images');
  });

  it('skips undefined fields in extracted data', () => {
    const existing = { title: 'Widget', price: 9.99, brand: 'Acme' };
    const extracted: ExtractedProduct = {
      sku: 'WDG-001',
      title: 'Widget',
      // price and brand are undefined — should not appear as changed
    };

    const changed = diffProductFields(existing, extracted);
    expect(changed).toEqual([]);
  });

  it('detects new field when existing value is undefined', () => {
    const existing = { title: 'Widget' };
    const extracted: ExtractedProduct = {
      sku: 'WDG-001',
      title: 'Widget',
      brand: 'NewBrand',
    };

    const changed = diffProductFields(existing, extracted);
    expect(changed).toContain('brand');
  });
});

// ---------------------------------------------------------------------------
// performIncrementalImport
// ---------------------------------------------------------------------------

describe('performIncrementalImport', () => {
  const mockSend = vi.fn();

  beforeEach(() => {
    vi.clearAllMocks();
    const mockDocClient = { send: mockSend } as any;
    setDynamoDocClient(mockDocClient);
  });

  it('marks products as created when no existing record found', async () => {
    // No existing products found
    mockSend.mockResolvedValue({ Items: [] });

    const extracted: ExtractedProduct[] = [
      { sku: 'NEW-001', title: 'New Product', price: 10.0 },
    ];

    const summary = await performIncrementalImport(
      'tenant-1',
      'supplier-1',
      extracted,
      'ProductsTable'
    );

    expect(summary.newProducts).toBe(1);
    expect(summary.updatedProducts).toBe(0);
    expect(summary.unchangedProducts).toBe(0);
    expect(summary.results[0]).toEqual({ sku: 'NEW-001', action: 'created' });
  });

  it('marks products as unchanged when all fields match', async () => {
    // Existing product matches extracted
    mockSend.mockResolvedValue({
      Items: [
        {
          PK: 'TENANT#tenant-1',
          SK: 'PRODUCT#prod-1',
          sku: 'EXIST-001',
          title: 'Existing Product',
          price: 25.0,
          brand: 'BrandX',
        },
      ],
    });

    const extracted: ExtractedProduct[] = [
      { sku: 'EXIST-001', title: 'Existing Product', price: 25.0, brand: 'BrandX' },
    ];

    const summary = await performIncrementalImport(
      'tenant-1',
      'supplier-1',
      extracted,
      'ProductsTable'
    );

    expect(summary.unchangedProducts).toBe(1);
    expect(summary.newProducts).toBe(0);
    expect(summary.updatedProducts).toBe(0);
    expect(summary.results[0]).toEqual({ sku: 'EXIST-001', action: 'unchanged' });
  });

  it('marks products as updated and persists only changed fields', async () => {
    // First call: query existing product
    mockSend.mockResolvedValueOnce({
      Items: [
        {
          PK: 'TENANT#tenant-1',
          SK: 'PRODUCT#prod-1',
          sku: 'UPD-001',
          title: 'Old Title',
          price: 10.0,
          brand: 'BrandX',
        },
      ],
    });

    // Second call: UpdateCommand for changed fields
    mockSend.mockResolvedValueOnce({});

    const extracted: ExtractedProduct[] = [
      { sku: 'UPD-001', title: 'New Title', price: 15.0, brand: 'BrandX' },
    ];

    const summary = await performIncrementalImport(
      'tenant-1',
      'supplier-1',
      extracted,
      'ProductsTable'
    );

    expect(summary.updatedProducts).toBe(1);
    expect(summary.results[0].action).toBe('updated');
    expect(summary.results[0].changedFields).toContain('title');
    expect(summary.results[0].changedFields).toContain('price');
    expect(summary.results[0].changedFields).not.toContain('brand');

    // Verify the UpdateCommand was called
    expect(mockSend).toHaveBeenCalledTimes(2);
  });

  it('handles products without SKU as new', async () => {
    const extracted: ExtractedProduct[] = [
      { sku: '', title: 'No SKU Product' },
    ];

    const summary = await performIncrementalImport(
      'tenant-1',
      'supplier-1',
      extracted,
      'ProductsTable'
    );

    expect(summary.newProducts).toBe(1);
    expect(summary.results[0]).toEqual({ sku: '', action: 'created' });
    // Should not query DynamoDB for empty SKU
    expect(mockSend).not.toHaveBeenCalled();
  });

  it('handles mixed results across multiple products', async () => {
    // Query for SKU-A returns existing (will be unchanged)
    mockSend.mockResolvedValueOnce({
      Items: [
        { PK: 'TENANT#t1', SK: 'PRODUCT#p1', sku: 'SKU-A', title: 'Product A', price: 5.0 },
      ],
    });
    // Query for SKU-B returns nothing (will be new)
    mockSend.mockResolvedValueOnce({ Items: [] });
    // Query for SKU-C returns existing (will be updated)
    mockSend.mockResolvedValueOnce({
      Items: [
        { PK: 'TENANT#t1', SK: 'PRODUCT#p3', sku: 'SKU-C', title: 'Old C', price: 20.0 },
      ],
    });
    // Update command for SKU-C
    mockSend.mockResolvedValueOnce({});

    const extracted: ExtractedProduct[] = [
      { sku: 'SKU-A', title: 'Product A', price: 5.0 },  // unchanged
      { sku: 'SKU-B', title: 'New B', price: 10.0 },     // new
      { sku: 'SKU-C', title: 'New C', price: 20.0 },     // updated (title changed)
    ];

    const summary = await performIncrementalImport(
      'tenant-1',
      'supplier-1',
      extracted,
      'ProductsTable'
    );

    expect(summary.unchangedProducts).toBe(1);
    expect(summary.newProducts).toBe(1);
    expect(summary.updatedProducts).toBe(1);
  });
});
