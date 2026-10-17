/**
 * Cognito PreSignUp Lambda trigger for MerchOS.
 *
 * Determines, at sign-up time, whether a user was invited and should be
 * auto-confirmed. It does NOT persist the authoritative tenant/role identity:
 *   - Invited self-registration (PreSignUp_SignUp): request auto-confirm /
 *     auto-verify (these flags ARE honoured for this source). The authoritative
 *     invited tenant/role is assigned later by PostConfirmation (which looks up
 *     the invitation by the verified email and writes the server-managed
 *     mutable custom:tenantIdAssigned + custom:role). We do NOT rely on mutating
 *     event.request.userAttributes to persist custom attributes, because that is
 *     not a supported persistence mechanism and public app clients cannot write
 *     these fields.
 *   - Admin-created invite (PreSignUp_AdminCreateUser): AWS IGNORES the
 *     autoConfirm/autoVerify flags; the invite-user handler already sets the
 *     immutable custom:tenantId + custom:role AT creation.
 *   - Self sign-up (no invitation): defer identity assignment to
 *     PostConfirmation (custom:tenantIdAssigned).
 *   - Lookup FAILURE (DynamoDB/KMS): fail closed (throw) — never fall through to
 *     mint an owner.
 *
 * Requirements: FR-3.1, FR-6.3
 */

import type { PreSignUpTriggerEvent } from 'aws-lambda';
import { Logger } from '@aws-lambda-powertools/logger';

import {
  findGenuineInvitationByEmail,
  InvitationLookupError,
  AmbiguousInvitationError,
  type InvitationRecord,
} from '../registration/invitation-lookup';

// Re-export for backward compatibility with existing importers/tests.
export { InvitationLookupError, parseExpiryToEpochSeconds } from '../registration/invitation-lookup';

const logger = new Logger({ serviceName: 'merch-os-pre-sign-up' });

export async function handler(
  event: PreSignUpTriggerEvent,
): Promise<PreSignUpTriggerEvent> {
  const email = event.request.userAttributes['email'] ?? event.userName;

  logger.info('PreSignUp trigger invoked', {
    email,
    triggerSource: event.triggerSource,
  });

  // The invitation lookup is intentionally OUTSIDE a catch-all. A lookup
  // FAILURE (DynamoDB/KMS) must propagate and fail the sign-up closed. It must
  // never be swallowed and fall through to the owner self-signup path, which
  // would silently grant tenant-owner privileges on an infrastructure error.
  let invitation: InvitationRecord | null;
  try {
    invitation = await findGenuineInvitationByEmail(email);
  } catch (error) {
    logger.error('PreSignUp failing closed due to invitation lookup error', {
      error: error instanceof Error ? error.message : String(error),
      email,
    });
    // Ambiguous invitations and lookup failures both fail the sign-up closed.
    if (error instanceof InvitationLookupError || error instanceof AmbiguousInvitationError) {
      throw error;
    }
    throw new InvitationLookupError('Invitation lookup failed', error);
  }

  if (invitation) {
    // Genuine, non-expired invitation found for an invited SELF-registration
    // (PreSignUp_SignUp).
    //
    // IMPORTANT: we DO NOT auto-confirm or auto-verify here. Two reasons:
    //   1. Mailbox control — possessing an invitation record for an email does
    //      NOT prove the registrant controls that mailbox. The registrant must
    //      still complete the normal email-code confirmation (ConfirmSignUp).
    //   2. Trigger ordering — if PreSignUp auto-confirms, Cognito does NOT run
    //      PostConfirmation for that SignUp, so the authoritative invited
    //      identity + Seller group assignment (which live in PostConfirmation)
    //      would never execute. Leaving confirmation to the normal flow ensures
    //      PostConfirmation runs on ConfirmSignUp.
    //
    // We also do not mutate request.userAttributes (unsupported persistence,
    // and public clients cannot write these fields). PostConfirmation performs
    // the authoritative assignment after verified email confirmation.
    logger.info('Genuine invitation found; deferring confirmation to normal email flow + PostConfirmation', {
      email,
      tenantId: invitation.tenantId,
      role: invitation.role,
      triggerSource: event.triggerSource,
    });
    return event;
  }

  // Self sign-up: successful lookup, no invitation. Defer identity assignment
  // to PostConfirmation (custom:tenantIdAssigned). Nothing mutated here.
  logger.info('Self sign-up detected; deferring identity assignment to PostConfirmation', {
    email,
  });

  return event;
}
