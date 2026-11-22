import { describe, it, expect } from 'vitest';
import { stableStringify } from '../../services/stable-json';
import { computeKey } from '../../services/response-cache';

describe('stableStringify', () => {
  it('keeps nested fields and sorts keys at every level', () => {
    expect(stableStringify({ b: 1, a: { d: 2, c: [{ f: 3, e: 4 }] } })).toBe('{"a":{"c":[{"e":4,"f":3}],"d":2},"b":1}');
  });

  it('is independent of property order', () => {
    expect(stableStringify({ x: 1, y: { p: 1, q: 2 } })).toBe(stableStringify({ y: { q: 2, p: 1 }, x: 1 }));
  });
});

describe('response cache keys (regression)', () => {
  // The old key used an array replacer that dropped all product data, so every
  // product shared one cache entry and got another product's listing.
  it('differ for different products', () => {
    const key = (name: string) =>
      computeKey({
        generationType: 'title',
        marketplace: 'takealot',
        promptVersion: 2,
        normalizedInput: stableStringify({ productData: { name, description: null } }),
      });
    expect(key('Russell Hobbs Kettle')).not.toBe(key('Defy Fridge'));
    expect(key('Russell Hobbs Kettle')).toBe(key('Russell Hobbs Kettle'));
  });
});
