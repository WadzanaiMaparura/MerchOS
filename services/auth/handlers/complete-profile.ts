/**
 * Complete-profile Lambda handler for POST /auth/complete-profile.
 *
 * Authenticated recovery endpoint. A genuine self-registration owner whose
 * tenant/owner records are missing supplies full name, phone, organisation
 * name, and an optional explicit marketing-consent choice. The server derives
 * sub, tenantId, role, and verified email from trusted JWT claims — the body
 * never carries identity, tenantId, role, or a contact email.
 *
 * Invitation-linked, non-owner, unverified, or conflicting identities are
 * rejected and never create or take ownership of a tenant.
 *
 * Writes the CANONICAL registration schema (PR #28): tenant metadata (SK=
 * METADATA, field ownerId), owner profile (SK=PROFILE#USER#<userId>) and the
 * single shared marketing-consent record (SK=CONSENT#USER#<userId>), preserving
 * the richer consent audit metadata (channels, consentTextVersion, source).
 */

import middy from '@middy/core';
import crypto from 'node:crypto';
import { injectLambdaContext } from '@aws-lambda-powertools/logger/middleware';
import { captureLambdaHandler } from '@aws-lambda-powertools/tracer/middleware';
import { logMetrics } from '@aws-lambda-powertools/metrics/middleware';
import type { APIGatewayProxyEventV2, APIGatewayProxyResultV2 } from 'aws-lambda';

import { logger, tracer, metrics } from '../../shared/middleware/powertools';
import { accessTokenMiddleware } from '../../shared/middleware/access-token';
import { inputValidationMiddleware } from '../../shared/middleware/input-validation';
import { completeProfileSchema } from '../schemas';
import { emitAuthEvent } from '../utils/event-emitter';
import { findInvitation } from '../repository/profile-status-repository';
import {
  completeOwnerProfile,
  TransientPersistenceError,
} from '../repository/profile-completion-repository';
import { CONSENT_TEXT_VERSION } from '../config/consent';
import type { ConsentChannel } from '../registration/types';

interface JwtClaims {
  sub?: string;
  email?: string;
  email_verified?: string | boolean;
  token_use?: string;
  'custom:tenantId'?: string;
  'custom:role'?: string;
  [key: string]: unknown;
}

interface CompleteProfileBody {
  fullName: string;
  phone: string;
  organisationName: string;
  consentGranted: boolean;
  consentChannels: ConsentChannel[];
}

interface CompleteProfileEvent extends APIGatewayProxyEventV2 {
  body: CompleteProfileBody;
}

/** Max transient-retry attempts for the atomic write. */
const MAX_TRANSIENT_RETRIES = 2;

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

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function baseHandler(event: CompleteProfileEvent): Promise<APIGatewayProxyResultV2> {
  const claims = extractClaims(event);

  // Access-token-only use (token_use === 'access') is enforced centrally by
  // accessTokenMiddleware in the middy stack below, which short-circuits with
  // 401 before this handler runs — so a non-access token never reaches here
  // and can never create or take ownership of a tenant.
  if (!claims || !claims.sub || !claims.email) {
    logger.warn('complete-profile: missing required JWT claims');
    return json(401, { error: { code: 'UNAUTHORIZED', message: 'No valid session found' } });
  }

  if (!isEmailVerified(claims.email_verified)) {
    logger.warn('complete-profile: email not verified', { userId: claims.sub });
    return json(403, { error: { code: 'EMAIL_NOT_VERIFIED', message: 'Email must be verified' } });
  }

  const tenantId = claims['custom:tenantId'] ?? '';
  const role = claims['custom:role'] ?? '';
  if (!tenantId) {
    logger.warn('complete-profile: no tenant claim', { userId: claims.sub });
    return json(403, { error: { code: 'NO_TENANT', message: 'No tenant associated with this account' } });
  }

  // Only an owner may create tenant metadata / owner profile.
  if (role !== 'owner') {
    logger.warn('complete-profile: non-owner rejected', { userId: claims.sub, role });
    return json(403, { error: { code: 'NOT_OWNER', message: 'Only an account owner can complete this profile' } });
  }

  const tenantsTable = process.env['TENANTS_TABLE'];
  const invitationsTable = process.env['INVITATIONS_TABLE'];
  if (!tenantsTable || !invitationsTable) {
    logger.error('complete-profile: missing table environment variables', {
      hasTenants: !!tenantsTable,
      hasInvitations: !!invitationsTable,
    });
    return json(500, { error: { code: 'INTERNAL_ERROR', message: 'Service misconfigured' } });
  }

  const identity = {
    userId: claims.sub,
    email: claims.email,
    tenantId,
    role,
  };

  // Safeguard: an invitation-linked account must never create/own a tenant here.
  const invitation = await findInvitation(invitationsTable, tenantId, identity.email);
  if (invitation) {
    logger.warn('complete-profile: invited account rejected from owner creation', {
      userId: identity.userId,
      tenantId,
    });
    return json(409, {
      error: { code: 'INVITED_ACCOUNT', message: 'This account is managed via invitation' },
    });
  }

  const body = event.body;

  // Server-controlled correlation id for this completion. The canonical
  // consent/profile keys are keyed on userId (not registrationId), so a retry
  // naturally converges on the same records via the create-only conditions.
  const registrationId = crypto.randomUUID();

  let attempt = 0;
  // eslint-disable-next-line no-constant-condition
  while (true) {
    try {
      const outcome = await completeOwnerProfile(tenantsTable, {
        tenantId,
        userId: identity.userId,
        email: identity.email,
        role,
        fullName: body.fullName,
        phone: body.phone,
        organisationName: body.organisationName,
        registrationId,
        consentGranted: body.consentGranted,
        consentChannels: body.consentChannels,
        consentTextVersion: CONSENT_TEXT_VERSION,
      });

      if (outcome.result === 'conflict') {
        logger.error('complete-profile: durable-state conflict', {
          userId: identity.userId,
          tenantId,
          reason: outcome.reason,
        });
        return json(409, {
          error: { code: 'PROFILE_CONFLICT', message: 'Profile could not be completed due to a conflict' },
        });
      }

      // created or already_completed → emit best-effort event only on first creation.
      if (outcome.result === 'created') {
        // Best-effort; a publish failure must not fail the durable persistence.
        try {
          await emitAuthEvent({
            detailType: 'auth.user.registered',
            detail: {
              userId: identity.userId,
              tenantId,
              timestamp: new Date().toISOString(),
            },
          });
        } catch (err) {
          logger.error('complete-profile: event emit failed (persistence succeeded)', {
            userId: identity.userId,
            tenantId,
            error: err instanceof Error ? err.message : String(err),
          });
        }
      }

      logger.info('complete-profile succeeded', {
        userId: identity.userId,
        tenantId,
        outcome: outcome.result,
      });
      return json(200, { status: 'complete' });
    } catch (err) {
      if (err instanceof TransientPersistenceError && attempt < MAX_TRANSIENT_RETRIES) {
        const backoff = 100 * Math.pow(2, attempt);
        attempt += 1;
        logger.warn('complete-profile: transient failure, retrying', {
          userId: identity.userId,
          attempt,
        });
        await delay(backoff);
        continue;
      }

      logger.error('complete-profile: persistence failed', {
        userId: identity.userId,
        tenantId,
        error: err instanceof Error ? err.message : String(err),
      });
      return json(500, {
        error: { code: 'INTERNAL_ERROR', message: 'Unable to complete profile' },
      });
    }
  }
}

export const handler = middy(baseHandler)
  .use(injectLambdaContext(logger, { clearState: true }))
  .use(captureLambdaHandler(tracer))
  .use(logMetrics(metrics, { captureColdStartMetric: true }))
  .use(accessTokenMiddleware())
  .use(inputValidationMiddleware({ schema: completeProfileSchema, source: 'body' }));
