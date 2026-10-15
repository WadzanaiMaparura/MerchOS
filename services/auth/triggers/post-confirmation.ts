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
 *        The id is written to the MUTABLE custom:tenantIdAssigned attribute
 *        (the immutable custom:tenantId cannot be set after creation).
 *
 * This stage does NOT emit auth.user.registered. That event signifies a
 * completed registration (durable tenant metadata + owner profile + consent),
 * which this stage does not commit. Per the approved architecture the event is
 * emitted only by the downstream completion path after those records are
 * persisted. Emitting it here would falsely signal completion.
 *
 * Deliberately OUT OF SCOPE (gated to other work): writing tenant metadata,
 * owner-profile or consent records, emitting auth.user.registered, and any
 * SQS/DLQ reconciliation. No organisation name is derived from the email
 * address.
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

import { PendingRegistrationRepository } from '../registration/pending-registration-repository';
import { findGenuineInvitationByEmail } from '../registration/invitation-lookup';

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
  // Effective existing tenant id = immutable invited id OR the server-managed
  // mutable id (idempotent re-runs). Either means identity is already assigned.
  const existingImmutableTenantId = event.request.userAttributes['custom:tenantId'] ?? '';
  const existingAssignedTenantId = event.request.userAttributes['custom:tenantIdAssigned'] ?? '';
  const existingTenantId = existingImmutableTenantId || existingAssignedTenantId;
  const existingRole = event.request.userAttributes['custom:role'] ?? '';
  const userId = event.userName;
  const userPoolId = event.userPoolId;

  logger.info('PostConfirmation trigger invoked', {
    userId,
    hasExistingTenant: Boolean(existingTenantId),
    triggerSource: event.triggerSource,
  });

  // -------------------------------------------------------------------------
  // Already-identified users: identity is already authoritative. This covers
  // (a) invited users (immutable custom:tenantId set at creation) and
  // (b) a prior successful self-signup assignment (custom:tenantIdAssigned),
  // which makes repeated trigger invocations idempotent. Preserve it; never
  // convert to a new owner. Nothing further to assign here.
  // -------------------------------------------------------------------------
  if (existingTenantId && existingRole) {
    logger.info('Confirmed user already has authoritative identity; preserving', {
      userId,
    });

    // No auth.user.registered emission here — see file header.
    return event;
  }

  // -------------------------------------------------------------------------
  // Invited self-registrant (PreSignUp_SignUp): no identity attributes were set
  // during sign-up (PreSignUp no longer mutates request.userAttributes). The
  // authoritative invited tenant/role must come from the invitation record,
  // matched by the VERIFIED Cognito email. If a genuine, non-expired invitation
  // exists, assign the INVITED tenant/role — never owner, never recovery.
  //
  // The lookup is fail-closed: a DynamoDB/KMS failure throws, so we never fall
  // through to the owner-recovery path for a user who might be an invitee.
  // -------------------------------------------------------------------------
  let tenantId: string;
  let role: string;

  const invitation = await findGenuineInvitationByEmail(email);
  if (invitation) {
    logger.info('Confirmed user matches a genuine invitation; assigning invited identity', {
      userId,
    });
    tenantId = invitation.tenantId;
    role = invitation.role;
  } else {
    // -----------------------------------------------------------------------
    // Self-signup: resolve the server-trusted tenantId from the EXACT pending
    // registration identified by the registrationId passed through Cognito
    // clientMetadata. We never select a record by email alone.
    // -----------------------------------------------------------------------
    role = 'owner';
    const registrationId = readRegistrationId(event);
    const repository = getRepository();

    let pending = null;
    if (registrationId) {
      pending = await repository.getById(registrationId);
    } else {
      logger.warn('No registrationId in clientMetadata; using recovery fallback', { userId });
    }

    if (pending) {
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
  }

  // -------------------------------------------------------------------------
  // Persist the trusted identity via a supported server-side Cognito op.
  // AdminUpdateUserAttributes is idempotent — re-running with the same values
  // is safe, so repeated trigger invocations converge to the same identity.
  // We write the MUTABLE server-managed attribute: the immutable custom:tenantId
  // cannot be set after creation. For both invited self-registrants and self-
  // signups, the id lands in custom:tenantIdAssigned, and PreTokenGeneration
  // maps it onto the custom:tenantId token claim for downstream consumers.
  // -------------------------------------------------------------------------
  try {
    await getCognitoClient().send(
      new AdminUpdateUserAttributesCommand({
        UserPoolId: userPoolId,
        Username: userId,
        UserAttributes: [
          { Name: 'custom:tenantIdAssigned', Value: tenantId },
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
  //
  // No auth.user.registered emission here either — identity assignment is not
  // registration completion. The downstream completion path owns that event.

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
