/**
 * Cognito PostConfirmation Lambda trigger for MerchOS.
 *
 * Scope: server-trusted identity assignment AND durable registration
 * completion for self-signups.
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
 * 2. Ensure Seller group membership (idempotent, retry-safe).
 * 3. For a NEW self-signup backed by a genuine, non-expired, email-matching
 *    pending record: commit the DURABLE registration records (tenant metadata +
 *    owner profile + marketing-consent) into the tenants table idempotently and
 *    atomically, THEN emit auth.user.registered, THEN delete the pending record.
 *
 * Strict ordering & failure handling (durable-completion path):
 *   assign identity -> ensure group -> COMMIT durable records -> emit event
 *   -> delete pending.
 *   - The durable write is idempotent + atomic (single TransactWriteItems with
 *     create-only conditions); a retry of an already-completed registration is
 *     a safe no-op.
 *   - auth.user.registered is emitted ONLY AFTER the durable records commit, so
 *     it never falsely signals completion.
 *   - The pending record is deleted ONLY AFTER durable completion succeeds, so
 *     the single copy of the profile/consent data is preserved for retry if any
 *     earlier step fails.
 *   - If identity assignment, group membership, or the durable write fails, the
 *     trigger throws: no success event is emitted and the pending record is
 *     retained. If only the post-commit cleanup (event emit / pending delete)
 *     fails, the records are already durable and the operation is retry-safe.
 *
 * Paths that do NOT commit durable records here (by design):
 *   - Admin-created invitees (fast path): already fully provisioned at creation.
 *   - Invited self-registrants: identity comes from the invitation; their
 *     durable tenant/profile belongs to the inviting tenant and is not created
 *     from a self-signup pending record.
 *   - Profile-recovery fallback (missing/expired/mismatched pending): a usable
 *     owner identity is assigned but NO profile/consent data is fabricated, so
 *     there is nothing durable to commit and no registration event is emitted.
 *
 * Deliberately OUT OF SCOPE: SQS/DLQ reconciliation. No organisation name is
 * derived from the email address.
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
import { RegistrationCompletionRepository } from '../registration/registration-completion-repository';
import { findGenuineInvitationByEmail } from '../registration/invitation-lookup';
import { emitAuthEvent } from '../utils/event-emitter';
import type { PendingRegistrationRecord } from '../registration/types';

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

/** Allow tests to inject a mocked completion repository. */
let completionRepositoryOverride: RegistrationCompletionRepository | null = null;
export function __setRegistrationCompletionRepositoryForTesting(
  repo: RegistrationCompletionRepository | null
): void {
  completionRepositoryOverride = repo;
}

function getCompletionRepository(): RegistrationCompletionRepository {
  return completionRepositoryOverride ?? new RegistrationCompletionRepository();
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
  // Set ONLY on the new-self-signup path when a genuine, non-expired,
  // email-matching pending record is resolved. Its presence is the signal to
  // run durable registration completion (commit tenant/profile/consent, emit
  // the event, delete the pending record). It stays null for the invited,
  // prior-self-signup, and recovery-fallback paths, which never commit durable
  // records here.
  let completablePending: PendingRegistrationRecord | null = null;

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
    // (self-signup). Preserve it (never re-run recovery, never convert to a new
    // owner) BUT do not short-circuit: fall through so Seller group membership
    // is (re)ensured. This makes a prior group-add failure retryable — the
    // attribute write is skipped (already correct) and only the idempotent
    // group-add runs.
    // -----------------------------------------------------------------------
    logger.info('Self-signup identity already assigned; preserving and ensuring group', { userId });
    tenantId = existingAssignedTenantId;
    role = existingRole;
    attributesAlreadyCorrect = true;
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
        // Genuine, verified, non-expired pending record — eligible for durable
        // registration completion after identity + group are established.
        completablePending = pending;
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
  // Place the user in the 'Seller' Cognito group so the RBAC resolver (which
  // authorizes on the cognito:groups claim) grants dashboard access. This
  // applies to BOTH:
  //   - invited self-registrants (matching the admin invite-user flow), and
  //   - new self-signup OWNERS (who would otherwise have tenant/role attributes
  //     but no recognised group claim and be denied access).
  //
  // AdminAddUserToGroup is idempotent (re-adding an existing member succeeds),
  // so this is retry-safe: if the attribute write succeeded on a prior run but
  // the group-add failed, a retry repairs group membership without changing the
  // tenant/role. If it fails we throw — a user with identity but no group would
  // be unauthorized, so we must NOT report success. Tenant isolation and the
  // owner role are unaffected (group membership is the platform-role claim; the
  // tenant-scoped role/tenant live in the custom attributes).
  //
  // We never run the group-assignment on the admin-created-invitee fast path
  // (that returned earlier) — the admin handler already added that user.
  try {
    await getCognitoClient().send(
      new AdminAddUserToGroupCommand({
        UserPoolId: userPoolId,
        Username: userId,
        GroupName: 'Seller',
      }),
    );
  } catch (error) {
    logger.error('Failed to add user to Seller group', {
      userId,
      isInvited,
      error: error instanceof Error ? error.message : String(error),
    });
    throw error;
  }

  logger.info('Trusted identity assigned', { userId, isInvited });

  // -------------------------------------------------------------------------
  // Durable registration completion (new self-signup only).
  //
  // Only runs when a genuine, non-expired, email-matching pending record was
  // resolved above. Invited users, prior self-signups and the recovery
  // fallback never reach this (completablePending stays null) — they have no
  // self-signup profile/consent data to commit here.
  //
  // Strict ordering: identity + group are already established above. We now
  //   1) COMMIT the durable tenant/profile/consent records (idempotent+atomic),
  //   2) emit auth.user.registered (only after the commit), and
  //   3) delete the pending record (only after the commit).
  //
  // If the commit fails we throw: no event, no delete, pending retained for a
  // safe retry. If only the post-commit cleanup fails, the records are already
  // durable, so the registration is complete and the retry is safe.
  // -------------------------------------------------------------------------
  if (completablePending) {
    const pending = completablePending;

    // 1) Commit durable records. Uses the SERVER-trusted tenantId from the
    // pending record and the VERIFIED Cognito userId/email — never any
    // client-supplied tenant id or role.
    const completion = await getCompletionRepository().complete({
      tenantId: pending.tenantId,
      userId,
      email,
      fullName: pending.fullName,
      phoneNumber: pending.phoneNumber,
      organisationName: pending.organisationName,
      marketingConsent: pending.marketingConsent,
      registrationId: pending.registrationId,
    });

    if (completion.committed) {
      logger.info('Durable registration records committed', { userId });
    } else {
      // Idempotent retry: records already existed. Still proceed to ensure the
      // event/cleanup happen (they are themselves idempotent / safe).
      logger.info('Durable registration already complete; ensuring event + cleanup', { userId });
    }

    // 2) Emit the registration event — strictly AFTER the durable commit, so it
    // can never signal completion before the records exist. A failure here
    // throws; the records are already durable, so a retry re-emits (consumers
    // must treat auth.user.registered idempotently, keyed on tenantId/userId).
    await emitAuthEvent({
      detailType: 'auth.user.registered',
      detail: {
        userId,
        email,
        tenantId: pending.tenantId,
        registrationId: pending.registrationId,
        timestamp: new Date().toISOString(),
      },
    });
    logger.info('auth.user.registered emitted', { userId });

    // 3) Delete the pending record — strictly AFTER durable completion. This is
    // the ONLY point at which the pending record is removed, so its profile/
    // consent data is never lost before being durably persisted. deleteById is
    // idempotent (a missing record is a no-op), so a retry is safe.
    await getRepository().deleteById(pending.registrationId);
    logger.info('Pending registration deleted after durable completion', { userId });
  }

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
