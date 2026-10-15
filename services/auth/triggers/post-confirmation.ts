/**
 * Cognito PostConfirmation Lambda trigger for MerchOS.
 *
 * Scope of THIS change: server-trusted identity assignment only.
 *
 * Responsibilities:
 * 1. Determine the authoritative custom:tenantId / custom:role for the
 *    confirmed user and persist them with AdminUpdateUserAttributes (a
 *    supported server-side Cognito operation), rather than relying on
 *    PreSignUp_SignUp request.userAttributes mutations.
 *      - Invited users: preserve the invitation's tenant and role (already set
 *        on the auto-confirmed user); never convert them into a new owner.
 *      - Self-signups: use the server-generated tenantId from the matching,
 *        non-expired pending-registration record and assign the 'owner' role.
 * 2. Emit auth.user.registered on success.
 *
 * Deliberately OUT OF SCOPE (gated to other work): writing tenant metadata,
 * owner-profile or consent records, and any SQS/DLQ reconciliation. No
 * organisation name is derived from the email address.
 *
 * Failure handling: if required identity assignment cannot be completed, the
 * trigger throws so the operation is not silently reported as successful. It
 * never falls through to grant owner privileges on an error path.
 */

import crypto from 'node:crypto';
import type { PostConfirmationTriggerEvent } from 'aws-lambda';
import {
  CognitoIdentityProviderClient,
  AdminUpdateUserAttributesCommand,
} from '@aws-sdk/client-cognito-identity-provider';
import { Logger } from '@aws-lambda-powertools/logger';

import { emitAuthEvent } from '../utils/event-emitter';
import { PendingRegistrationRepository } from '../registration/pending-registration-repository';

const logger = new Logger({ serviceName: 'merch-os-post-confirmation' });

// ---------------------------------------------------------------------------
// Cognito client (singleton)
// ---------------------------------------------------------------------------

let cognitoClient: CognitoIdentityProviderClient | null = null;

function getCognitoClient(): CognitoIdentityProviderClient {
  if (!cognitoClient) {
    cognitoClient = new CognitoIdentityProviderClient({
      region: process.env['AWS_REGION'] ?? 'eu-west-1',
    });
  }
  return cognitoClient;
}

/** Allow tests to inject a mocked repository without real AWS calls. */
let repositoryOverride: PendingRegistrationRepository | null = null;
export function __setPendingRegistrationRepositoryForTesting(
  repo: PendingRegistrationRepository | null
): void {
  repositoryOverride = repo;
}

function getRepository(): PendingRegistrationRepository {
  return repositoryOverride ?? new PendingRegistrationRepository();
}

// ---------------------------------------------------------------------------
// Handler
// ---------------------------------------------------------------------------

export async function handler(
  event: PostConfirmationTriggerEvent,
): Promise<PostConfirmationTriggerEvent> {
  const email = (event.request.userAttributes['email'] ?? '').trim().toLowerCase();
  const existingTenantId = event.request.userAttributes['custom:tenantId'] ?? '';
  const existingRole = event.request.userAttributes['custom:role'] ?? '';
  const userId = event.userName;
  const userPoolId = event.userPoolId;

  logger.info('PostConfirmation trigger invoked', {
    userId,
    hasExistingTenant: Boolean(existingTenantId),
    triggerSource: event.triggerSource,
  });

  // -------------------------------------------------------------------------
  // Invited users: identity is already authoritative. Preserve it; never
  // convert to a new owner. Nothing further to assign here.
  // -------------------------------------------------------------------------
  if (existingTenantId && existingRole) {
    logger.info('Confirmed user already has authoritative identity; preserving', {
      userId,
    });

    await emitRegisteredEvent({ userId, email, tenantId: existingTenantId });
    return event;
  }

  // -------------------------------------------------------------------------
  // Self-signup: resolve the server-trusted tenantId from the EXACT pending
  // registration identified by the registrationId passed through Cognito
  // clientMetadata. We never select a record by email alone.
  // -------------------------------------------------------------------------
  let tenantId: string;
  const role = 'owner';

  const registrationId = readRegistrationId(event);
  const repository = getRepository();

  let pending = null;
  if (registrationId) {
    pending = await repository.getById(registrationId);
  } else {
    logger.warn('No registrationId in clientMetadata; using recovery fallback', { userId });
  }

  if (pending) {
    // Correlate the pending record against the confirmed, verified Cognito
    // email, and confirm it has not expired. Any mismatch/expiry falls back to
    // recovery rather than trusting a stale or wrong record.
    const emailMatches = pending.email.trim().toLowerCase() === email;
    const expired = PendingRegistrationRepository.isExpired(pending);

    if (!emailMatches) {
      logger.warn('Pending registration email does not match verified identity; using recovery fallback', {
        userId,
      });
      tenantId = reserveFallbackTenantId();
    } else if (expired) {
      logger.warn('Pending registration expired; using recovery fallback', { userId });
      tenantId = reserveFallbackTenantId();
    } else {
      tenantId = pending.tenantId;
    }
  } else {
    // Missing/expired pending registration. Approved profile-recovery
    // fallback: provision a usable owner identity with a server-generated
    // tenantId so the account is not stranded. We do NOT fabricate business
    // profile data (no org name derived from email); durable profile capture
    // remains the responsibility of the existing profile-completion path.
    logger.warn('No pending registration resolved; using recovery fallback', { userId });
    tenantId = reserveFallbackTenantId();
  }

  // -------------------------------------------------------------------------
  // Persist the trusted identity via a supported server-side Cognito op.
  // AdminUpdateUserAttributes is idempotent — re-running with the same values
  // is safe, so repeated trigger invocations converge to the same identity.
  // -------------------------------------------------------------------------
  try {
    await getCognitoClient().send(
      new AdminUpdateUserAttributesCommand({
        UserPoolId: userPoolId,
        Username: userId,
        UserAttributes: [
          { Name: 'custom:tenantId', Value: tenantId },
          { Name: 'custom:role', Value: role },
        ],
      }),
    );
  } catch (error) {
    // Fail loudly: do not emit a success event and do not leave the system
    // reporting success when identity assignment failed.
    logger.error('Failed to assign trusted identity attributes', {
      userId,
      error: error instanceof Error ? error.message : String(error),
    });
    throw error;
  }

  logger.info('Trusted identity assigned', { userId });

  // IMPORTANT: do NOT delete the pending registration here. This change only
  // assigns Cognito identity attributes; it does not yet persist the durable
  // tenant metadata, owner profile and consent records. Deleting now would
  // lose the only copy of that profile/consent data. The pending record is
  // retained (and will TTL-expire as a backstop) until the approved downstream
  // completion path commits the durable records and performs cleanup. That
  // path remains separately gated.

  await emitRegisteredEvent({ userId, email, tenantId });
  return event;
}

/**
 * Reads the registrationId from the supported Cognito clientMetadata path.
 * Returns undefined when absent.
 */
function readRegistrationId(event: PostConfirmationTriggerEvent): string | undefined {
  const metadata = (event.request as { clientMetadata?: Record<string, string> })
    .clientMetadata;
  const value = metadata?.['registrationId'];
  return value && value.trim().length > 0 ? value.trim() : undefined;
}

/**
 * Reserves a server-generated tenantId for the profile-recovery fallback.
 * Kept as a small helper so the intent (server-side, never client-supplied)
 * is explicit and easy to test.
 */
function reserveFallbackTenantId(): string {
  return crypto.randomUUID();
}

async function emitRegisteredEvent(args: {
  userId: string;
  email: string;
  tenantId: string;
}): Promise<void> {
  try {
    await emitAuthEvent({
      detailType: 'auth.user.registered',
      detail: {
        userId: args.userId,
        email: args.email,
        tenantId: args.tenantId,
        timestamp: new Date().toISOString(),
      },
    });
    logger.info('auth.user.registered event emitted', { userId: args.userId });
  } catch (error) {
    // Event emission failure is non-fatal to identity assignment, but we log
    // it so it is observable.
    logger.warn('Failed to emit auth.user.registered event', {
      error: error instanceof Error ? error.message : String(error),
    });
  }
}
