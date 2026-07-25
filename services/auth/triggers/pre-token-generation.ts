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

import type { PreTokenGenerationTriggerEvent } from 'aws-lambda';
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
  event: PreTokenGenerationTriggerEvent,
): Promise<PreTokenGenerationTriggerEvent> {
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

    // Inject custom claims into the access token
    event.response.claimsOverrideDetails = {
      ...event.response.claimsOverrideDetails,
      claimsToAddOrOverride: {
        ...event.response.claimsOverrideDetails?.claimsToAddOrOverride,
        'custom:tenantId': tenantId,
        'custom:role': role,
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
