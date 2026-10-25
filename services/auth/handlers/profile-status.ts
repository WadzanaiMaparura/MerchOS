/**
 * Profile-status Lambda handler for GET /auth/profile-status.
 *
 * Authenticated endpoint (API Gateway JWT authorizer). Reports whether the
 * confirmed Cognito user has a persisted MerchOS tenant + owner profile, so the
 * Seller Dashboard can route a genuine self-registration owner with an
 * incomplete profile into the recovery flow.
 *
 * Identity is derived ONLY from trusted authorizer JWT claims — never from the
 * request body/query. Invitation-linked accounts are classified separately and
 * are never routed into self-registration owner creation.
 *
 * Requirements: registration lifecycle Stage 1 (recovery).
 */

import middy from '@middy/core';
import { injectLambdaContext } from '@aws-lambda-powertools/logger/middleware';
import { captureLambdaHandler } from '@aws-lambda-powertools/tracer/middleware';
import { logMetrics } from '@aws-lambda-powertools/metrics/middleware';
import type { APIGatewayProxyEventV2, APIGatewayProxyResultV2 } from 'aws-lambda';

import { logger, tracer, metrics } from '../../shared/middleware/powertools';
import { accessTokenMiddleware } from '../../shared/middleware/access-token';
import {
  findInvitation,
  readProfileState,
  classifyProfileState,
} from '../repository/profile-status-repository';
import type { ProfileStatusResponse } from '../../shared/types/registration.types';

interface JwtClaims {
  sub?: string;
  email?: string;
  email_verified?: string | boolean;
  token_use?: string;
  'custom:tenantId'?: string;
  'custom:role'?: string;
  [key: string]: unknown;
}

function json(statusCode: number, body: unknown): APIGatewayProxyResultV2 {
  return {
    statusCode,
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  };
}

function extractClaims(event: APIGatewayProxyEventV2): JwtClaims | undefined {
  const requestContext = event.requestContext as unknown as Record<string, unknown>;
  const authorizer = requestContext?.['authorizer'] as Record<string, unknown> | undefined;
  const jwt = authorizer?.['jwt'] as Record<string, unknown> | undefined;
  return jwt?.['claims'] as JwtClaims | undefined;
}

function isEmailVerified(claim: string | boolean | undefined): boolean {
  return claim === true || claim === 'true';
}

async function baseHandler(event: APIGatewayProxyEventV2): Promise<APIGatewayProxyResultV2> {
  const claims = extractClaims(event);

  // Access-token-only use (token_use === 'access') is enforced centrally by
  // accessTokenMiddleware in the middy stack below, which short-circuits with
  // 401 before this handler runs — so a non-access token never reaches here.
  if (!claims || !claims.sub || !claims.email) {
    logger.warn('profile-status: missing required JWT claims');
    return json(401, { error: { code: 'UNAUTHORIZED', message: 'No valid session found' } });
  }

  const tenantsTable = process.env['TENANTS_TABLE'];
  const invitationsTable = process.env['INVITATIONS_TABLE'];
  if (!tenantsTable || !invitationsTable) {
    logger.error('profile-status: missing table environment variables', {
      hasTenants: !!tenantsTable,
      hasInvitations: !!invitationsTable,
    });
    return json(500, { error: { code: 'INTERNAL_ERROR', message: 'Service misconfigured' } });
  }

  const identity = {
    userId: claims.sub,
    email: claims.email,
    tenantId: claims['custom:tenantId'] ?? '',
    role: claims['custom:role'] ?? '',
  };
  const emailVerified = isEmailVerified(claims.email_verified);

  // An unverified email short-circuits before any datastore lookup.
  if (!emailVerified) {
    const status: ProfileStatusResponse = { status: 'not_verified' };
    logger.info('profile-status resolved (not verified)', { userId: identity.userId });
    return json(200, status);
  }

  // Without a tenantId claim we cannot locate any records; treat as needing
  // completion (email is verified at this point).
  if (!identity.tenantId) {
    const status: ProfileStatusResponse = { status: 'needs_profile_completion' };
    logger.info('profile-status resolved (no tenant claim)', {
      userId: identity.userId,
      status: status.status,
    });
    return json(200, status);
  }

  try {
    const [state, invitation] = await Promise.all([
      readProfileState(tenantsTable, identity.tenantId, identity.userId),
      findInvitation(invitationsTable, identity.tenantId, identity.email),
    ]);

    const status = classifyProfileState(identity, emailVerified, state, invitation);

    logger.info('profile-status resolved', {
      userId: identity.userId,
      tenantId: identity.tenantId,
      status,
    });

    const response: ProfileStatusResponse = { status };
    return json(200, response);
  } catch (error) {
    logger.error('profile-status: lookup failed', {
      userId: identity.userId,
      tenantId: identity.tenantId,
      error: error instanceof Error ? error.message : String(error),
    });
    return json(500, { error: { code: 'INTERNAL_ERROR', message: 'Unable to resolve profile status' } });
  }
}

export const handler = middy(baseHandler)
  .use(injectLambdaContext(logger, { clearState: true }))
  .use(captureLambdaHandler(tracer))
  .use(logMetrics(metrics, { captureColdStartMetric: true }))
  .use(accessTokenMiddleware());
