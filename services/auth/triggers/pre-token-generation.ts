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
 * them into the access token via claimsOverrideDetails. This ensures the
 * access token always contains the tenantId and role for downstream
 * authorization checks.
 */
export async function handler(
  event: PreTokenGenerationV2TriggerEvent,
): Promise<PreTokenGenerationV2TriggerEvent> {
  // The effective tenant id is the immutable custom:tenantId (invited users,
  // set at creation) OR the server-managed mutable custom:tenantIdAssigned
  // (self-signup users, set by PostConfirmation). We always surface it under
  // the single custom:tenantId CLAIM so downstream RBAC and tenant-isolation
  // middleware remain unchanged regardless of which attribute holds the value.
  const immutableTenantId = event.request.userAttributes['custom:tenantId'] ?? '';
  const assignedTenantId = event.request.userAttributes['custom:tenantIdAssigned'] ?? '';
  const tenantId = immutableTenantId || assignedTenantId;
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

    // Inject custom claims into the ACCESS token. The V2_0 trigger uses
    // `claimsAndScopeOverrideDetails.accessTokenGeneration.claimsToAddOrOverride`
    // — the V1 `claimsOverrideDetails` shape only affected the ID token and is
    // ignored under V2_0, which is what previously left access tokens without a
    // tenant claim and broke tenant-context on every API.
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
