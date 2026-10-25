/**
 * Cognito PreTokenGeneration Lambda trigger (V2) for MerchOS.
 *
 * Injects custom claims into the issued tokens:
 * - custom:tenantId — tenant isolation identifier
 * - custom:role — user's role within the tenant
 * - email / email_verified — projected from verified user attributes
 *
 * These claims are consumed by the RBAC middleware and tenant-context
 * middleware to enforce authorization and data isolation at the API layer.
 *
 * The trigger is wired with the V2 PreTokenGeneration operation
 * (UserPoolOperation.PRE_TOKEN_GENERATION_CONFIG + LambdaVersion.V2_0 in the
 * AuthStack), so Cognito sends a V2 event and reads overrides from
 * response.claimsAndScopeOverrideDetails. The API's HttpJwtAuthorizer validates
 * the ACCESS token, so the identity claims below are injected into the access
 * token; they are also mirrored into the id token for frontend consumers.
 *
 * Requirements: FR-3.3, FR-4.2
 */

import type { PreTokenGenerationV2TriggerEvent } from 'aws-lambda';
import { Logger } from '@aws-lambda-powertools/logger';

// ---------------------------------------------------------------------------
// Logger
// ---------------------------------------------------------------------------

const logger = new Logger({ serviceName: 'merch-os-pre-token-generation' });

// ---------------------------------------------------------------------------
// Handler
// ---------------------------------------------------------------------------

/**
 * Cognito PreTokenGeneration trigger handler (V2).
 *
 * Extracts custom:tenantId and custom:role from user attributes and injects
 * them — together with the verified email, when present — into both the id and
 * access tokens via claimsAndScopeOverrideDetails. The group configuration is
 * carried forward so Cognito group membership is not suppressed.
 */
export async function handler(
  event: PreTokenGenerationV2TriggerEvent,
): Promise<PreTokenGenerationV2TriggerEvent> {
  const tenantId = event.request.userAttributes['custom:tenantId'] ?? '';
  const role = event.request.userAttributes['custom:role'] ?? '';
  const userId = event.userName;

  logger.info('PreTokenGeneration trigger invoked', {
    userId,
    tenantId,
    role,
    triggerSource: event.triggerSource,
  });

  try {
    if (!tenantId) {
      logger.warn('No tenantId found in user attributes', { userId });
    }

    if (!role) {
      logger.warn('No role found in user attributes', { userId });
    }

    // Build the identity claims to inject. tenantId/role are always present
    // (default ''). Values are derived ONLY from the Cognito event's user
    // attributes — never from client-supplied input.
    const claims: Record<string, string> = {
      'custom:tenantId': tenantId,
      'custom:role': role,
    };

    // Only include email when the source attribute actually exists — never
    // fabricate an address. (email is NOT logged to avoid PII in logs.)
    const email = event.request.userAttributes['email'];
    if (email) {
      claims['email'] = email;
      // Represent verification as the canonical lowercase string JWT claims use.
      // Treat anything other than an explicit 'true' as unverified — never
      // promote an absent/false attribute to verified.
      const rawVerified = event.request.userAttributes['email_verified'];
      claims['email_verified'] = rawVerified === 'true' ? 'true' : 'false';
    }

    // Inject claims into both tokens using the V2 response shape, preserving
    // any pre-existing overrides via spreads:
    //  - accessTokenGeneration: the API authorizer validates the access token,
    //    so the Stage 1 identity claims MUST live here.
    //  - idTokenGeneration: mirror the same claims so frontend id-token
    //    consumers keep seeing tenantId/role/email.
    //  - groupOverrideDetails: carry the request's group configuration forward
    //    so Cognito group membership is not suppressed. Respect a deliberate
    //    existing response override if one was already set.
    const existing = event.response.claimsAndScopeOverrideDetails;
    event.response.claimsAndScopeOverrideDetails = {
      ...existing,
      idTokenGeneration: {
        ...existing?.idTokenGeneration,
        claimsToAddOrOverride: {
          ...existing?.idTokenGeneration?.claimsToAddOrOverride,
          ...claims,
        },
      },
      accessTokenGeneration: {
        ...existing?.accessTokenGeneration,
        claimsToAddOrOverride: {
          ...existing?.accessTokenGeneration?.claimsToAddOrOverride,
          ...claims,
        },
      },
      groupOverrideDetails:
        existing?.groupOverrideDetails ?? event.request.groupConfiguration,
    };

    logger.info('Claims injected into id and access tokens', {
      userId,
      tenantId,
      role,
      hasEmail: !!email,
    });
  } catch (error) {
    // Log error but don't block token generation — return event as-is
    logger.error('Error in PreTokenGeneration trigger', {
      error: error instanceof Error ? error.message : String(error),
      userId,
    });
  }

  return event;
}
