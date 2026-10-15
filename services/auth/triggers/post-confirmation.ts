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
  AdminAddUserToGroupCommand,
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
  const existingImmutableTenantId = event.request.userAttributes['custom:tenantId'] ?? '';
  const existingAssignedTenantId = event.request.userAttributes['custom:tenantIdAssigned'] ?? '';
  const existingRole = event.request.userAttributes['custom:role'] ?? '';
  const userId = event.userName;
  const userPoolId = event.userPoolId;

  logger.info('PostConfirmation trigger invoked', {
    userId,
    triggerSource: event.triggerSource,
  });

  // -------------------------------------------------------------------------
  // FAST PATH — admin-created invitee. The admin invite-user handler sets the
  // IMMUTABLE custom:tenantId AND the role AT creation and already placed the
  // user in the Seller group. This user is fully provisioned; nothing to do.
  // (The immutable attribute is the reliable signal: self-registration never
  // sets custom:tenantId, only the mutable custom:tenantIdAssigned.)
  // -------------------------------------------------------------------------
  if (existingImmutableTenantId && existingRole) {
    logger.info('Admin-created invitee already fully provisioned; preserving', { userId });
    // No auth.user.registered emission here — see file header.
    return event;
  }

  // -------------------------------------------------------------------------
  // Invited self-registrant (PreSignUp_SignUp): the authoritative invited
  // tenant/role must come from the invitation record, matched by the VERIFIED
  // Cognito email (email confirmation proves mailbox control). If a genuine,
  // non-expired invitation exists, assign the INVITED tenant/role — never
  // owner, never recovery.
  //
  // The lookup is fail-closed: a DynamoDB/KMS failure (or ambiguity) throws, so
  // we never fall through to the owner-recovery path for a possible invitee.
  // -------------------------------------------------------------------------
  let tenantId: string;
  let role: string;
  let isInvited = false;
  // When true, the identity attributes already match what we would assign, so
  // we skip the attribute write but STILL ensure group membership (retry-safe
  // repair after a prior AdminAddUserToGroup failure).
  let attributesAlreadyCorrect = false;

  const invitation = await findGenuineInvitationByEmail(email);
  if (invitation) {
    isInvited = true;
    tenantId = invitation.tenantId;
    role = invitation.role;

    // Retry-safety. Any PRESENT attribute that conflicts with the authoritative
    // invitation fails closed (never overwrite a conflicting identity). We only
    // skip the attribute write when BOTH attributes are already present AND
    // match the invitation — a partially-populated identity (one attribute
    // missing) must still be fully written so the user is never left without a
    // required tenant id or role.
    const tenantConflict =
      Boolean(existingAssignedTenantId) && existingAssignedTenantId !== invitation.tenantId;
    const roleConflict = Boolean(existingRole) && existingRole !== invitation.role;
    if (tenantConflict || roleConflict) {
      logger.error('Existing identity conflicts with invitation; failing closed', {
        userId,
        existingAssignedTenantId,
        existingRole,
        invitationTenantId: invitation.tenantId,
        invitationRole: invitation.role,
      });
      throw new Error('Inconsistent authoritative identity for invited user');
    }

    const tenantAlreadyCorrect = existingAssignedTenantId === invitation.tenantId;
    const roleAlreadyCorrect = existingRole === invitation.role;
    attributesAlreadyCorrect = tenantAlreadyCorrect && roleAlreadyCorrect;

    if (attributesAlreadyCorrect) {
      logger.info('Invited identity fully assigned; will ensure group membership only', { userId });
    } else {
      // Includes both the first-time assignment and the partial-state repair
      // (one attribute present+matching, the other missing). Write BOTH.
      logger.info('Assigning/repairing invited identity attributes', {
        userId,
        tenantAlreadyCorrect,
        roleAlreadyCorrect,
      });
    }
  } else if (existingAssignedTenantId && existingRole) {
    // -----------------------------------------------------------------------
    // No invitation, but identity was already assigned by a prior invocation
    // (self-signup). Idempotent no-op: preserve it, never convert to a new
    // owner, and do not run the recovery path again. Self-signups are not group
    // assigned here, so there is nothing to repair.
    // -----------------------------------------------------------------------
    logger.info('Self-signup identity already assigned; preserving (idempotent)', { userId });
    return event;
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
  // Persist the trusted identity via a supported server-side Cognito op, unless
  // a prior invocation already wrote the exact same values (retry repair path).
  // AdminUpdateUserAttributes is idempotent — re-running with the same values
  // is safe. We write the MUTABLE server-managed attribute: the immutable
  // custom:tenantId cannot be set after creation. For both invited self-
  // registrants and self-signups the id lands in custom:tenantIdAssigned, and
  // PreTokenGeneration maps it onto the custom:tenantId token claim.
  // -------------------------------------------------------------------------
  if (!attributesAlreadyCorrect) {
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
  }

  // -------------------------------------------------------------------------
  // Invited self-registrants must also be placed in the 'Seller' Cognito group
  // so the RBAC resolver (which authorizes on the cognito:groups claim) grants
  // them access — matching the admin invite-user flow, which always adds the
  // user to 'Seller'. AdminAddUserToGroup is idempotent (re-adding an existing
  // member succeeds), so this is retry-safe. If it fails we throw: an invited
  // user with identity attributes but no group would be unauthorized, so we do
  // NOT report success.
  //
  // Self-signup owners are not group-assigned here; that remains part of the
  // separately gated completion path and is out of scope for this change.
  if (isInvited) {
    try {
      await getCognitoClient().send(
        new AdminAddUserToGroupCommand({
          UserPoolId: userPoolId,
          Username: userId,
          GroupName: 'Seller',
        }),
      );
    } catch (error) {
      logger.error('Failed to add invited user to Seller group', {
        userId,
        error: error instanceof Error ? error.message : String(error),
      });
      throw error;
    }
  }

  logger.info('Trusted identity assigned', { userId, isInvited });

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
