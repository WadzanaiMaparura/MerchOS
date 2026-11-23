/** Small HTTP helpers (API Gateway HTTP API, payload v2). */

import type { APIGatewayProxyEventV2, APIGatewayProxyResultV2 } from 'aws-lambda';

export type HttpResult = APIGatewayProxyResultV2 & { statusCode: number; body: string };

export function json(statusCode: number, body: unknown, headers: Record<string, string> = {}): HttpResult {
  return {
    statusCode,
    headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store', ...headers },
    body: JSON.stringify(body),
  };
}

const error = (statusCode: number, code: string, message: string): HttpResult =>
  json(statusCode, { error: { code, message } });

export const badRequest = (message: string): HttpResult => error(400, 'BAD_REQUEST', message);
export const forbidden = (message: string): HttpResult => error(403, 'FORBIDDEN', message);
export const notFound = (message = 'Not found'): HttpResult => error(404, 'NOT_FOUND', message);
export const conflict = (message: string): HttpResult => error(409, 'CONFLICT', message);
export const gone = (message: string): HttpResult => error(410, 'LINK_EXPIRED', message);
export const tooMany = (message: string): HttpResult => error(429, 'RATE_LIMITED', message);
export const serverError = (): HttpResult => error(500, 'INTERNAL', 'Something went wrong. Please try again.');

/** Raw body text (handles base64), or '' when missing/too large. */
export function rawBody(event: APIGatewayProxyEventV2, maxBytes = 16_000): string {
  if (!event.body) return '';
  const raw = event.isBase64Encoded ? Buffer.from(event.body, 'base64').toString('utf8') : event.body;
  return raw.length > maxBytes ? '' : raw;
}

/** Parsed JSON body, or undefined when missing/invalid/too large. */
export function readJson(event: APIGatewayProxyEventV2, maxBytes = 16_000): unknown {
  const raw = rawBody(event, maxBytes);
  if (!raw) return undefined;
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

export const sourceIp = (event: APIGatewayProxyEventV2): string => event.requestContext?.http?.sourceIp ?? 'unknown';
