/**
 * Cognito PreTokenGeneration Lambda trigger (V2_0) for MerchOS.
 *
 * Injects custom claims into the access token:
 * - custom:tenantId — tenant isolation identifier
 * - custom:role — user's role within the tenant
 *
 * These claims are used by the RBAC middleware and tenant-context middleware
 * to enforce authorization and data isolation at the API layer.
 *
 * V2_0 response structure:
 *   event.response.claimsAndScopeOverrideDetails.accessTokenGeneration.claimsToAddOrOverride
 * (V1 used event.response.claimsOverrideDetails.claimsToAddOrOverride.)
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
 * Cognito PreTokenGeneration trigger handler (V2_0).
 *
 * Extracts custom:tenantId and custom:role from user attributes and injects
 * them into the access token via
 * `claimsAndScopeOverrideDetails.accessTokenGeneration.claimsToAddOrOverride`.
 * This ensures the access token always contains the tenantId and role for
 * downstream authorization checks. Existing claims are preserved.
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

    // Inject custom claims into the access token (V2_0 structure).
    // Preserve any existing claimsAndScopeOverrideDetails / accessTokenGeneration
    // claims rather than overwriting unrelated claims.
    //
    // Group projection: `cognito:groups` is a reserved group claim that AWS
    // requires to be managed via `groupOverrideDetails` (NOT claimsToAddOrOverride).
    // We pass the request's existing group configuration straight through so the
    // user's real group membership (e.g. Seller) is preserved in both the access
    // and ID tokens — this is what the RBAC middleware reads to resolve the role.
    // (An empty/null groupOverrideDetails would SUPPRESS groups, so we must copy
    // event.request.groupConfiguration verbatim.)
    event.response.claimsAndScopeOverrideDetails = {
      ...event.response.claimsAndScopeOverrideDetails,
      accessTokenGeneration: {
        ...event.response.claimsAndScopeOverrideDetails?.accessTokenGeneration,
        claimsToAddOrOverride: {
          ...event.response.claimsAndScopeOverrideDetails?.accessTokenGeneration
            ?.claimsToAddOrOverride,
          'custom:tenantId': tenantId,
          'custom:role': role,
        },
      },
      groupOverrideDetails: event.request.groupConfiguration,
    };

    logger.info('Claims injected into access token', {
      userId,
      tenantId,
      role,
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
