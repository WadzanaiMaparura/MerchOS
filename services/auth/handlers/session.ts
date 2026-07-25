/**
 * Session Lambda handler for GET /auth/session.
 *
 * Returns the decoded JWT claims for the authenticated user.
 * This endpoint is protected by the API Gateway JWT authorizer, so the token
 * has already been validated before reaching this handler. We simply extract
 * the claims from the authorizer context and return them.
 *
 * No Cognito SDK calls are needed — claims are decoded by API Gateway.
 *
 * Requirements: FR-8
 */

import middy from '@middy/core';
import { injectLambdaContext } from '@aws-lambda-powertools/logger/middleware';
import { captureLambdaHandler } from '@aws-lambda-powertools/tracer/middleware';
import { logMetrics } from '@aws-lambda-powertools/metrics/middleware';
import type { APIGatewayProxyEventV2, APIGatewayProxyResultV2 } from 'aws-lambda';

import { logger, tracer, metrics } from '../../shared/middleware/powertools';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface JwtClaims {
  sub: string;
  email: string;
  'custom:tenantId': string;
  'custom:role': string;
  exp: string;
  [key: string]: unknown;
}

interface SessionResponse {
  userId: string;
  email: string;
  tenantId: string;
  role: string;
  expiresAt: number;
}

// ---------------------------------------------------------------------------
// Handler
// ---------------------------------------------------------------------------

/**
 * Core session handler logic.
 *
 * Extracts decoded JWT claims from the API Gateway authorizer context
 * and returns them in a structured response. The JWT authorizer has already
 * validated the token signature, expiration, issuer, and audience.
 */
async function baseHandler(event: APIGatewayProxyEventV2): Promise<APIGatewayProxyResultV2> {
  // API Gateway v2 JWT authorizer places decoded claims at
  // event.requestContext.authorizer.jwt.claims
  const requestContext = event.requestContext as Record<string, unknown>;
  const authorizer = requestContext['authorizer'] as Record<string, unknown> | undefined;
  const jwt = authorizer?.['jwt'] as Record<string, unknown> | undefined;
  const claims = jwt?.['claims'] as JwtClaims | undefined;

  if (!claims) {
    logger.error('No JWT claims found in authorizer context');
    return {
      statusCode: 401,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        error: { code: 'UNAUTHORIZED', message: 'No valid session found' },
      }),
    };
  }

  const userId = claims['sub'];
  const email = claims['email'];
  const tenantId = claims['custom:tenantId'];
  const role = claims['custom:role'];
  const exp = claims['exp'];

  if (!userId || !email) {
    logger.error('JWT claims missing required fields', {
      hasSub: !!userId,
      hasEmail: !!email,
    });
    return {
      statusCode: 401,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        error: { code: 'UNAUTHORIZED', message: 'Invalid session claims' },
      }),
    };
  }

  const expiresAt = typeof exp === 'string' ? parseInt(exp, 10) : Number(exp);

  const sessionResponse: SessionResponse = {
    userId,
    email,
    tenantId: tenantId ?? '',
    role: role ?? '',
    expiresAt: isNaN(expiresAt) ? 0 : expiresAt,
  };

  logger.info('Session retrieved', { userId, tenantId });

  return {
    statusCode: 200,
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(sessionResponse),
  };
}

// ---------------------------------------------------------------------------
// Middleware Stack
// ---------------------------------------------------------------------------

export const handler = middy(baseHandler)
  .use(injectLambdaContext(logger, { clearState: true }))
  .use(captureLambdaHandler(tracer))
  .use(logMetrics(metrics, { captureColdStartMetric: true }));
