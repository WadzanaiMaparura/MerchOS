/**
 * Server-to-server client for the Product Intelligence API.
 *
 * The synthesize handler calls the Intelligence API (a separate HTTP API) to
 * generate listing content. Both APIs are authorised by the same Cognito pool,
 * so the handler forwards the caller's JWT rather than minting a service token.
 *
 * Uses the global fetch available in the Node.js 20 Lambda runtime. The call
 * function is injectable for testing via setIntelligenceCaller().
 */

import type { GlueGenerationResult } from './synthesis-glue';

export interface GenerateCall {
  type: string;
  productData: Record<string, unknown>;
  marketplace?: string;
  options?: Record<string, unknown>;
}

/** A single generation request + its result (or null if the call failed). */
export interface IntelligenceCaller {
  generate(
    call: GenerateCall,
    authToken: string
  ): Promise<GlueGenerationResult | null>;
}

/** Base URL of the Intelligence API (set in the product-api Lambda env). */
function intelligenceBaseUrl(): string {
  return process.env['INTELLIGENCE_API_URL'] ?? '';
}

/**
 * Default production caller — POSTs to {INTELLIGENCE_API_URL}/intelligence/generate
 * forwarding the caller's bearer token. Returns null on non-2xx or network
 * error so a single failed generation type does not abort the whole batch; the
 * orchestrator decides how to handle partial/empty results.
 */
const defaultCaller: IntelligenceCaller = {
  async generate(call, authToken) {
    const baseUrl = intelligenceBaseUrl();
    if (!baseUrl) return null;
    try {
      const res = await fetch(`${baseUrl}/intelligence/generate`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${authToken}`,
        },
        body: JSON.stringify(call),
      });
      if (!res.ok) {
        return null;
      }
      const data = (await res.json()) as GlueGenerationResult;
      return data;
    } catch {
      return null;
    }
  },
};

let caller: IntelligenceCaller = defaultCaller;

/** Override the intelligence caller (test seam). */
export function setIntelligenceCaller(c: IntelligenceCaller): void {
  caller = c;
}

/** Reset to the default production caller. */
export function resetIntelligenceCaller(): void {
  caller = defaultCaller;
}

/** Resolve the active caller. */
export function getIntelligenceCaller(): IntelligenceCaller {
  return caller;
}
