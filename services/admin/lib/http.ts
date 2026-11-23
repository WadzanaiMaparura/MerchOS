/** Small HTTP helpers (API Gateway HTTP API, payload v2). */

import type { APIGatewayProxyEventV2, APIGatewayProxyResultV2 } from 'aws-lambda';

export type HttpResult = APIGatewayProxyResultV2 & { statusCode: number; body: string };

export function json(statusCode: number, body: unknown): HttpResult {
  return {
    statusCode,
    headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' },
    body: JSON.stringify(body),
  };
}

const error = (statusCode: number, code: string, message: string): HttpResult =>
  json(statusCode, { error: { code, message } });

export const badRequest = (message: string): HttpResult => error(400, 'BAD_REQUEST', message);
export const notFound = (message = 'Not found'): HttpResult => error(404, 'NOT_FOUND', message);
export const conflict = (message: string): HttpResult => error(409, 'CONFLICT', message);
export const serverError = (): HttpResult => error(500, 'INTERNAL', 'Something went wrong. Please try again.');

export function readJson(event: APIGatewayProxyEventV2, maxBytes = 8_000): unknown {
  if (!event.body) return undefined;
  const raw = event.isBase64Encoded ? Buffer.from(event.body, 'base64').toString('utf8') : event.body;
  if (raw.length > maxBytes) return undefined;
  try {
    return JSON.parse(raw);
  } catch {
    return undefined;
  }
}

/** The signed-in staff member (Cognito sub), attached by rbacMiddleware. */
export function staffOf(event: APIGatewayProxyEventV2): { userId: string; role: string } {
  const ctx = event.requestContext as unknown as { authorizer?: { rbac?: { userId?: string; role?: string } } };
  const rbac = ctx.authorizer?.rbac;
  if (!rbac?.userId || !rbac.role) throw new Error('No staff identity on the request');
  return { userId: rbac.userId, role: rbac.role };
}

export const UUID = /^[a-f0-9-]{36}$/;
