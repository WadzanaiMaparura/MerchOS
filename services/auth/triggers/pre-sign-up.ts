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
  if (result.Items && result.Items.length > 0) {
    return result.Items[0] as InvitationRecord;
  }
  return null;
}

// ---------------------------------------------------------------------------
// Handler
// ---------------------------------------------------------------------------

/**
 * Cognito PreSignUp trigger handler.
 *
 * For invited users:
 *   - Auto-confirms the user (skips email verification)
 *   - Auto-verifies the email
 *   - Assigns the invited role and tenantId via request.userAttributes
 *
 * For self sign-ups:
 *   - Generates a new tenantId (UUID)
 *   - Assigns the 'owner' role
 *
 * Note: Custom attributes are set on event.request.userAttributes which Cognito
 * persists after the trigger returns. The response object only supports
 * autoConfirmUser, autoVerifyEmail, and autoVerifyPhone flags.
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
    // Invited user: auto-confirm and preserve the authoritative invited
    // tenant and role. Invited users are auto-confirmed, so PostConfirmation
    // runs with these attributes already present; the invitation identity is
    // never converted into a new owner.
    logger.info('User was invited, auto-confirming', {
      email,
      tenantId: invitation.tenantId,
      role: invitation.role,
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
