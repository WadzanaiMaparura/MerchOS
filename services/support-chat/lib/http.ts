/** Small HTTP helpers for the chat APIs (API Gateway HTTP API, payload v2). */

import type { APIGatewayProxyEventV2, APIGatewayProxyResultV2 } from 'aws-lambda';

export type HttpResult = APIGatewayProxyResultV2 & { statusCode: number; body: string };

export function json(statusCode: number, body: unknown): HttpResult {
  return {
    statusCode,
    headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' },
    body: JSON.stringify(body),
  };
}

export const badRequest = (message: string): HttpResult => json(400, { error: { code: 'BAD_REQUEST', message } });
export const notFound = (message = 'Not found'): HttpResult => json(404, { error: { code: 'NOT_FOUND', message } });
export const tooMany = (message: string): HttpResult => json(429, { error: { code: 'RATE_LIMITED', message } });
export const conflict = (message: string): HttpResult => json(409, { error: { code: 'CONFLICT', message } });
export const unauthorized = (): HttpResult =>
  json(401, { error: { code: 'UNAUTHORIZED', message: 'Your chat session has expired. Please start a new chat.' } });

/** Parsed JSON body, or undefined when missing/invalid/too large. */
export function readJson(event: APIGatewayProxyEventV2, maxBytes = 16_000): unknown {
  if (!event.body) return undefined;
  const raw = event.isBase64Encoded ? Buffer.from(event.body, 'base64').toString('utf8') : event.body;
  if (raw.length > maxBytes) return undefined;
  try {
    return JSON.parse(raw);
  } catch {
    return undefined;
  }
}

export function header(event: { headers?: Record<string, string | undefined> }, name: string): string | undefined {
  const headers = event.headers ?? {};
  const key = Object.keys(headers).find((k) => k.toLowerCase() === name.toLowerCase());
  return key ? headers[key] : undefined;
}

export function bearer(event: APIGatewayProxyEventV2): string | undefined {
  const value = header(event, 'authorization');
  return value?.startsWith('Bearer ') ? value.slice(7).trim() : undefined;
}

/** Browsers always send Origin on cross-site fetch/WebSocket; require it to be ours. */
export function originAllowed(origin: string | undefined, allowed: readonly string[]): boolean {
  return !!origin && allowed.includes(origin);
}
