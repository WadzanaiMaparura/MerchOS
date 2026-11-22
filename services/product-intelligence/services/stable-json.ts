/**
 * Deterministic JSON: object keys sorted at every level, so the same data
 * always serialises the same way regardless of property order.
 *
 * Do NOT use `JSON.stringify(value, Object.keys(value).sort())` for this: an
 * array replacer is a property WHITELIST applied at every depth, so nested
 * fields not named at the top level are silently dropped. That bug made every
 * product's cache key identical (the product data serialised as {}).
 */
export function stableStringify(value: unknown): string {
  return JSON.stringify(sortKeys(value));
}

function sortKeys(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(sortKeys);
  if (value && typeof value === 'object') {
    return Object.fromEntries(
      Object.keys(value as Record<string, unknown>)
        .sort()
        .map((k) => [k, sortKeys((value as Record<string, unknown>)[k])]),
    );
  }
  return value;
}
