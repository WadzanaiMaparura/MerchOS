/**
 * Cognito PreSignUp Lambda trigger for MerchOS.
 *
 * Handles new user registration by:
 * 1. Checking if the user was invited (query DynamoDB invitations table)
 * 2. If invited: auto-confirm user, auto-verify email, assign invited role
 * 3. If self sign-up: generate a new tenantId and assign 'owner' role
 *
 * Requirements: FR-3.1, FR-6.3
 */

import type { PreSignUpTriggerEvent } from 'aws-lambda';
import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { DynamoDBDocumentClient, QueryCommand } from '@aws-sdk/lib-dynamodb';
import { Logger } from '@aws-lambda-powertools/logger';

// ---------------------------------------------------------------------------
// Logger
// ---------------------------------------------------------------------------

const logger = new Logger({ serviceName: 'merch-os-pre-sign-up' });

// ---------------------------------------------------------------------------
// DynamoDB Client (singleton)
// ---------------------------------------------------------------------------

let ddbDocClient: DynamoDBDocumentClient | null = null;

function getDynamoDocClient(): DynamoDBDocumentClient {
  if (!ddbDocClient) {
    const client = new DynamoDBClient({
      region: process.env['AWS_REGION'] ?? 'eu-west-1',
    });
    ddbDocClient = DynamoDBDocumentClient.from(client);
  }
  return ddbDocClient;
}

// ---------------------------------------------------------------------------
// Invitation Lookup
// ---------------------------------------------------------------------------

interface InvitationRecord {
  PK: string;
  SK: string;
  email: string;
  tenantId: string;
  role: string;
  status: string;
  /**
   * Expiry. Current records store Unix epoch SECONDS (number); legacy records
   * stored an ISO-8601 string. Both are supported during migration and parsed
   * via parseExpiryToEpochSeconds. Missing/malformed values fail closed.
   */
  expiresAt?: number | string;
}

/**
 * Raised when the invitation lookup itself fails (DynamoDB or KMS decrypt
 * error). This is distinct from a successful lookup that returns no invitation.
 * The handler MUST fail safe on this error and never fall through to the
 * owner self-signup path.
 */
export class InvitationLookupError extends Error {
  constructor(message: string, public readonly cause?: unknown) {
    super(message);
    this.name = 'InvitationLookupError';
  }
}

/**
 * Queries the invitations table for a pending invitation matching the email.
 * Uses the email-index GSI to look up invitations by email address.
 *
 * Returns:
 *   - the invitation record when a pending invitation exists;
 *   - `null` when the lookup SUCCEEDS but no invitation is found (legitimate
 *     self-signup path).
 *
 * Throws:
 *   - InvitationLookupError when the lookup FAILS (DynamoDB/KMS error). The
 *     caller must treat this as fail-closed and must not create an owner.
 */
async function findPendingInvitation(
  email: string,
): Promise<InvitationRecord | null> {
  const invitationsTable = process.env['INVITATIONS_TABLE'];
  if (!invitationsTable) {
    // A missing table configuration is a lookup failure, not a confirmed
    // "no invitation". Fail closed rather than silently granting owner.
    throw new InvitationLookupError('INVITATIONS_TABLE is not configured');
  }

  const docClient = getDynamoDocClient();

  let result;
  try {
    result = await docClient.send(
      new QueryCommand({
        TableName: invitationsTable,
        IndexName: 'email-index',
        KeyConditionExpression: 'email = :email',
        FilterExpression: '#status = :status',
        ExpressionAttributeNames: {
          '#status': 'status',
        },
        ExpressionAttributeValues: {
          ':email': email,
          ':status': 'pending',
        },
        Limit: 1,
      }),
    );
  } catch (error) {
    // DynamoDB or KMS (CMK decrypt) failure. Surface as a lookup error so the
    // handler fails safe instead of mis-classifying this as a self-signup.
    logger.error('Invitation lookup failed', {
      error: error instanceof Error ? error.message : String(error),
      email,
    });
    throw new InvitationLookupError('Invitation lookup failed', error);
  }

  // Successful query. Absence of items is a legitimate "no invitation".
  const candidate = result.Items?.[0] as Partial<InvitationRecord> | undefined;
  if (!candidate) {
    return null;
  }

  // Defence-in-depth against misclassification: only treat the row as an
  // invitation when it is unambiguously a genuine invitation record. A record
  // must have the invitation key shape (PK TENANT#..., SK INVITE#...) and carry
  // a tenantId and role. Anything else (e.g. a non-invitation row that happens
  // to share the email index) is ignored and treated as self-registration.
  const isGenuineInvitation =
    typeof candidate.PK === 'string' && candidate.PK.startsWith('TENANT#') &&
    typeof candidate.SK === 'string' && candidate.SK.startsWith('INVITE#') &&
    typeof candidate.tenantId === 'string' && candidate.tenantId.length > 0 &&
    typeof candidate.role === 'string' && candidate.role.length > 0 &&
    candidate.status === 'pending';

  if (!isGenuineInvitation) {
    logger.warn('Email-index row did not match a genuine invitation; treating as self-signup', {
      email,
    });
    return null;
  }

  // Explicit expiry check. DynamoDB TTL deletion is ASYNCHRONOUS, so an expired
  // record may still be readable; we must never accept it as valid or let it
  // drive auto-confirmation.
  //
  // Expiry must be present and valid. A missing or malformed expiry FAILS
  // CLOSED (treated as not-an-invitation) rather than granting invitation
  // privileges. Both the current numeric epoch (seconds) and the legacy ISO
  // string format are supported during migration.
  const expiresAtSeconds = parseExpiryToEpochSeconds(candidate.expiresAt);
  if (expiresAtSeconds === null) {
    logger.warn('Invitation has missing/malformed expiry; failing closed (self-signup)', {
      email,
    });
    return null;
  }

  const nowSeconds = Math.floor(Date.now() / 1000);
  if (expiresAtSeconds <= nowSeconds) {
    logger.warn('Invitation has expired; treating as self-signup', { email });
    return null;
  }

  return candidate as InvitationRecord;
}

/**
 * Parses an invitation expiry into Unix epoch SECONDS.
 *
 * Accepts:
 *   - number: Unix epoch seconds (current format);
 *   - string: ISO-8601 date (legacy format), converted to epoch seconds.
 *
 * Returns null for missing, wrong-typed, or unparseable values so callers can
 * fail closed. Non-finite / NaN inputs also return null.
 */
export function parseExpiryToEpochSeconds(value: unknown): number | null {
  if (typeof value === 'number') {
    return Number.isFinite(value) ? value : null;
  }
  if (typeof value === 'string' && value.trim().length > 0) {
    const ms = Date.parse(value);
    return Number.isNaN(ms) ? null : Math.floor(ms / 1000);
  }
  return null;
}

// ---------------------------------------------------------------------------
// Handler
// ---------------------------------------------------------------------------

/**
 * Cognito PreSignUp trigger handler.
 *
 * IMPORTANT — trigger sources differ:
 *   - PreSignUp_SignUp: a person self-registers through an app client. Here the
 *     autoConfirmUser / autoVerifyEmail response flags ARE honoured by Cognito,
 *     so an invited self-registrant can be auto-confirmed.
 *   - PreSignUp_AdminCreateUser: fired when the invite-user handler calls
 *     AdminCreateUser. AWS IGNORES autoConfirmUser / autoVerifyEmail for this
 *     source; the admin-created user is created in FORCE_CHANGE_PASSWORD status
 *     and is activated when a permanent password is set — NOT by these flags.
 *     For that path the invite-user handler sets the authoritative identity
 *     attributes AT creation; this trigger does not need to.
 *
 * Behaviour:
 *   - Invited (genuine, non-expired invitation found): set the invited
 *     tenantId/role on request.userAttributes and request auto-confirm/verify.
 *     Those flags only actually take effect for PreSignUp_SignUp; for
 *     AdminCreateUser they are a harmless no-op (identity is set at creation).
 *   - Self sign-up (successful lookup, no invitation): defer identity
 *     assignment to PostConfirmation (custom:tenantIdAssigned). Nothing mutated
 *     here, because for self sign-up these request.userAttributes mutations are
 *     not a reliable way to persist custom attributes.
 *   - Lookup FAILURE: fail closed (throw).
 */
export async function handler(
  event: PreSignUpTriggerEvent,
): Promise<PreSignUpTriggerEvent> {
  const email =
    event.request.userAttributes['email'] ?? event.userName;

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
    invitation = await findPendingInvitation(email);
  } catch (error) {
    logger.error('PreSignUp failing closed due to invitation lookup error', {
      error: error instanceof Error ? error.message : String(error),
      email,
    });
    // Throwing causes Cognito to reject the sign-up. This is the safe outcome:
    // we could not determine whether the user was invited, so we refuse rather
    // than risk minting a new tenant owner.
    throw error instanceof InvitationLookupError
      ? error
      : new InvitationLookupError('Invitation lookup failed', error);
  }

  if (invitation) {
    // Genuine, non-expired invitation. Preserve the authoritative invited
    // tenant and role; the invitation identity is never converted into a new
    // owner.
    //
    // Request auto-confirm/verify: these flags take effect ONLY for
    // PreSignUp_SignUp (invited self-registration). For PreSignUp_AdminCreateUser
    // AWS ignores them — that is expected and harmless, since the admin flow
    // activates the user via the password-set path, not via these flags.
    logger.info('Genuine invitation found', {
      email,
      tenantId: invitation.tenantId,
      role: invitation.role,
      triggerSource: event.triggerSource,
    });

    event.response.autoConfirmUser = true;
    event.response.autoVerifyEmail = true;

    event.request.userAttributes['custom:tenantId'] = invitation.tenantId;
    event.request.userAttributes['custom:role'] = invitation.role;
    return event;
  }

  // Self sign-up: a successful lookup returned no invitation.
  //
  // We deliberately do NOT assign custom:tenantId / custom:role here. In the
  // PreSignUp_SignUp flow these request.userAttributes mutations are not a
  // reliable way to persist custom attributes, and the authoritative,
  // server-trusted identity assignment for self-signups now happens in the
  // PostConfirmation trigger (using the server-generated tenantId from the
  // pending-registration record). Leaving them unset avoids minting an
  // unverified owner identity at this stage.
  logger.info('Self sign-up detected; deferring identity assignment to PostConfirmation', {
    email,
  });

  return event;
}
