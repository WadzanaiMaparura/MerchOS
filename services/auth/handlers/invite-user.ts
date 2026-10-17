/**
 * Invite User Lambda handler for POST /auth/invite.
 *
 * Protected endpoint — requires admin or owner role within the tenant.
 * Creates a Cognito user with suppressed welcome email, adds them to the
 * 'Seller' group, stores an invitation record in DynamoDB, and emits
 * an auth.user.invited event.
 *
 * Requirements: FR-4
 */

import middy from '@middy/core';
import crypto from 'node:crypto';
import type { APIGatewayProxyEventV2, APIGatewayProxyResultV2 } from 'aws-lambda';
import {
  AdminCreateUserCommand,
  AdminAddUserToGroupCommand,
  AdminRemoveUserFromGroupCommand,
  AdminDeleteUserCommand,
  UsernameExistsException,
  NotAuthorizedException,
} from '@aws-sdk/client-cognito-identity-provider';
import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { DynamoDBDocumentClient, PutCommand, DeleteCommand } from '@aws-sdk/lib-dynamodb';

import { inviteUserSchema } from '../schemas';
import { getCognitoClient } from '../utils/cognito-client';
import { emitAuthEvent } from '../utils/event-emitter';
import { inputValidationMiddleware } from '../../shared/middleware/input-validation';
import { rbacMiddleware } from '../../shared/middleware/rbac';
import { tenantContextMiddleware } from '../../shared/middleware/tenant-context';
import { logger } from '../../shared/middleware/powertools';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface InviteUserEvent extends APIGatewayProxyEventV2 {
  body: {
    email: string;
    role: string;
    tenantId: string;
  };
}

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
// Ambiguous-error detection
// ---------------------------------------------------------------------------

/**
 * Heuristic for an AWS SDK error whose outcome is ambiguous — the request may
 * have reached the service and succeeded even though the client saw an error
 * (timeouts, aborted connections, 5xx with no definitive result). Used so we
 * never destructively "roll back" an operation that might actually have taken
 * effect server-side.
 */
function isAmbiguousAwsError(err: unknown): boolean {
  const name = (err as { name?: string })?.name ?? '';
  const code = (err as { code?: string })?.code ?? '';
  const httpStatus = (err as { $metadata?: { httpStatusCode?: number } })?.$metadata?.httpStatusCode;
  const ambiguousNames = [
    'TimeoutError',
    'RequestTimeout',
    'RequestTimeoutException',
    'AbortError',
    'NetworkingError',
    'ServiceUnavailableException',
    'InternalErrorException',
  ];
  const ambiguousCodes = ['ETIMEDOUT', 'ECONNRESET', 'ECONNABORTED', 'EPIPE'];
  if (ambiguousNames.includes(name) || ambiguousCodes.includes(code)) return true;
  if (typeof httpStatus === 'number' && httpStatus >= 500) return true;
  const message = (err instanceof Error ? err.message : String(err)).toLowerCase();
  return message.includes('timeout') || message.includes('timed out') || message.includes('econnreset');
}

// ---------------------------------------------------------------------------
// Handler
// ---------------------------------------------------------------------------

/**
 * Core invite-user handler logic.
 *
 * Provisioning order and failure safety:
 *   1. AdminCreateUser (suppressed email) with the authoritative identity set
 *      AT creation: email, email_verified, immutable custom:tenantId, custom:role.
 *      The immutable custom:tenantId can only be populated at creation.
 *   2. AdminAddUserToGroup ('Seller'). If this fails, we COMPENSATE by deleting
 *      the just-created user so a retry is not blocked by UsernameExistsException.
 *   3. Store the invitation record in DynamoDB. If this fails, we COMPENSATE by
 *      removing the user from the group and deleting the user.
 *   4. Emit auth.user.invited and return 201.
 *
 * We never return success unless the user is fully provisioned AND the
 * invitation record is written. On any mid-flight failure we roll back the
 * partial user so the operation is effectively all-or-nothing and retry-safe.
 *
 * Confirmation path (informational): AdminCreateUser creates the user in
 * FORCE_CHANGE_PASSWORD status with a suppressed message. PreSignUp fires with
 * triggerSource PreSignUp_AdminCreateUser, but AWS IGNORES its autoConfirmUser /
 * autoVerifyEmail response flags for admin-created users. The user is activated
 * when they set a permanent password (admin-set temporary password or the
 * invitation/reset flow), not by trigger flags.
 *
 * Activation instructions (IMPORTANT): MessageAction 'SUPPRESS' disables
 * Cognito's built-in invitation email, so Cognito does NOT notify the invitee.
 * Delivery of activation / password-setup instructions is the responsibility of
 * the downstream notification path, driven by the auth.user.invited event
 * emitted on success (consumer not implemented in this PR — see gated work).
 * The invitation record's `token` + `invitationId` identify the invite for that
 * flow. If the invitee is never notified, no activation email is sent; this is
 * a known gap tracked with the gated notification/consumer work.
 */
async function baseHandler(event: InviteUserEvent): Promise<APIGatewayProxyResultV2> {
  const { email, role, tenantId } = event.body;

  // Read COGNITO_USER_POOL_ID — the variable name the AuthApi stack actually
  // injects (commonLambdaEnv). (Was previously COGNITO_TENANT_POOL_ID, which
  // the stack does not supply.)
  const userPoolId = process.env['COGNITO_USER_POOL_ID'];
  const invitationsTable = process.env['INVITATIONS_TABLE'];
  const eventBusName = process.env['EVENT_BUS_NAME'];

  if (!userPoolId || !invitationsTable) {
    logger.error('Missing required environment variables', {
      hasUserPoolId: !!userPoolId,
      hasInvitationsTable: !!invitationsTable,
    });
    return {
      statusCode: 500,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        error: { code: 'INTERNAL_ERROR', message: 'Service misconfigured' },
      }),
    };
  }

  // Extract inviting user from authorizer context
  const requestContext = event.requestContext as unknown as Record<string, unknown>;
  const authorizer = requestContext?.['authorizer'] as Record<string, unknown> | undefined;
  const rbac = authorizer?.['rbac'] as Record<string, unknown> | undefined;
  const invitedBy = (rbac?.['userId'] as string) ?? 'unknown';

  const cognitoClient = getCognitoClient();
  const token = crypto.randomUUID();
  const INVITATION_TTL_SECONDS = 7 * 24 * 60 * 60; // 7 days
  // TTL field MUST be a numeric Unix epoch (seconds) for DynamoDB TTL.
  const expiresAtEpoch = Math.floor(Date.now() / 1000) + INVITATION_TTL_SECONDS;
  // Separate ISO value for the API response contract.
  const expiresAtIso = new Date(expiresAtEpoch * 1000).toISOString();

  const invitationId = crypto.randomUUID();

  // Track how far provisioning got, so a mid-flight failure can be rolled back
  // and the operation remains all-or-nothing / retry-safe.
  let userCreated = false;
  let addedToGroup = false;
  // Set once the PutCommand has been DISPATCHED. The outcome may be ambiguous
  // (e.g. timeout/connection error after the write reached DynamoDB), so if the
  // write errors we must still attempt to remove any possibly-committed record.
  let recordWriteAttempted = false;

  const compensate = async (): Promise<{ ok: boolean }> => {
    // Best-effort rollback of partial provisioning. Each step is guarded so one
    // cleanup failure does not mask the original error; we track whether all
    // cleanup succeeded so callers can avoid claiming all-or-nothing when it did
    // not.
    let ok = true;

    // 1. Remove a possibly-committed invitation record. Conditional on this
    //    invocation's invitationId so we never delete a different/legitimate
    //    record (e.g. a concurrent successful invite for the same email).
    if (recordWriteAttempted) {
      try {
        await getDynamoDocClient().send(
          new DeleteCommand({
            TableName: invitationsTable,
            Key: { PK: `TENANT#${tenantId}`, SK: `INVITE#${email}` },
            ConditionExpression: 'invitationId = :iid',
            ExpressionAttributeValues: { ':iid': invitationId },
          }),
        );
      } catch (err) {
        // A ConditionalCheckFailedException means the record either was never
        // committed or belongs to another invocation — both are acceptable
        // (nothing of ours to remove). Any OTHER error is a real cleanup
        // failure that leaves possible residue.
        const name = (err as { name?: string })?.name;
        if (name !== 'ConditionalCheckFailedException') {
          ok = false;
          logger.error('Compensation: failed to delete possibly-committed invitation record', {
            email,
            invitationId,
            error: err instanceof Error ? err.message : String(err),
          });
        }
      }
    }

    // 2. Remove group membership.
    if (addedToGroup) {
      try {
        await cognitoClient.send(
          new AdminRemoveUserFromGroupCommand({
            UserPoolId: userPoolId,
            Username: email,
            GroupName: 'Seller',
          }),
        );
      } catch (err) {
        ok = false;
        logger.error('Compensation: failed to remove user from group', {
          email,
          error: err instanceof Error ? err.message : String(err),
        });
      }
    }

    // 3. Delete the partially provisioned user.
    if (userCreated) {
      try {
        await cognitoClient.send(
          new AdminDeleteUserCommand({ UserPoolId: userPoolId, Username: email }),
        );
      } catch (err) {
        ok = false;
        logger.error('Compensation: failed to delete partially provisioned user', {
          email,
          error: err instanceof Error ? err.message : String(err),
        });
      }
    }

    return { ok };
  };

  try {
    // Step 1: Create the Cognito user with the authoritative identity set AT
    // creation. The immutable custom:tenantId can ONLY be populated here (AWS
    // forbids updating it afterwards), so tenantId and role are supplied as
    // initial UserAttributes rather than via a later AdminUpdateUserAttributes.
    // We do NOT rely on the PreSignUp trigger mutating request.userAttributes.
    //
    // Ambiguous-outcome handling: AdminCreateUser is wrapped separately so a
    // timeout / connection error (where the user MAY have been created) is
    // never treated as "no user" and never triggers a delete. We cannot safely
    // distinguish "created then timed out" from "never created", so we DO NOT
    // mark userCreated and DO NOT delete; instead we surface an explicit,
    // recoverable warning. Deleting here could destroy a legitimately created
    // (or pre-existing) account.
    try {
      await cognitoClient.send(
        new AdminCreateUserCommand({
          UserPoolId: userPoolId,
          Username: email,
          MessageAction: 'SUPPRESS',
          UserAttributes: [
            { Name: 'email', Value: email },
            { Name: 'email_verified', Value: 'true' },
            { Name: 'custom:tenantId', Value: tenantId },
            { Name: 'custom:role', Value: role },
          ],
        }),
      );
      userCreated = true;
    } catch (createErr) {
      if (createErr instanceof UsernameExistsException) {
        // Definitive: the account already exists and was not created by us.
        // Rethrow so the outer handler returns 409 without any deletion.
        throw createErr;
      }
      if (isAmbiguousAwsError(createErr)) {
        // The create MAY have succeeded. Never delete on an ambiguous create.
        logger.error(
          'AdminCreateUser returned an ambiguous error; user may or may not exist. NOT deleting. Manual reconciliation may be required.',
          {
            email,
            tenantId,
            invitationId,
            error: createErr instanceof Error ? createErr.message : String(createErr),
          },
        );
        return {
          statusCode: 500,
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            error: {
              code: 'PROVISIONING_AMBIGUOUS',
              message:
                'User provisioning could not be confirmed. Please retry; if the account was created, retry will report it exists.',
            },
          }),
        };
      }
      // A definitive non-timeout failure before the user was created: nothing
      // to roll back (userCreated is still false). Rethrow to outer handler.
      throw createErr;
    }

    // Step 2: Add user to 'Seller' group. On failure, roll back the user.
    await cognitoClient.send(
      new AdminAddUserToGroupCommand({
        UserPoolId: userPoolId,
        Username: email,
        GroupName: 'Seller',
      }),
    );
    addedToGroup = true;

    // Step 3: Store the invitation record. On failure, roll back the user +
    // group so a retry is not blocked by UsernameExistsException. Mark the
    // write as attempted BEFORE dispatch: if the SDK call errors with an
    // ambiguous outcome (timeout/connection reset after the write reached
    // DynamoDB), compensation must still try to remove the possibly-committed
    // record (conditionally, by this invocation's invitationId).
    const docClient = getDynamoDocClient();
    recordWriteAttempted = true;
    await docClient.send(
      new PutCommand({
        TableName: invitationsTable,
        Item: {
          PK: `TENANT#${tenantId}`,
          SK: `INVITE#${email}`,
          invitationId,
          email,
          role,
          tenantId,
          status: 'pending',
          token,
          invitedBy,
          // Numeric epoch seconds — drives DynamoDB TTL. (The handler and
          // PreSignUp both treat this as the authoritative expiry; expiry is
          // also checked in code because TTL deletion is asynchronous.)
          expiresAt: expiresAtEpoch,
          createdAt: new Date().toISOString(),
        },
      }),
    );

    // Step 4: Emit auth.user.invited event (fire-and-forget)
    emitAuthEvent({
      detailType: 'auth.user.invited',
      detail: {
        invitationId,
        email,
        role,
        tenantId,
        invitedBy,
        timestamp: new Date().toISOString(),
      },
    }).catch((err) => {
      logger.error('Failed to emit auth.user.invited event', {
        error: err instanceof Error ? err.message : String(err),
      });
    });

    logger.info('User invited successfully', { email, role, tenantId, invitationId });

    return {
      statusCode: 201,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        invitationId,
        expiresAt: expiresAtIso,
      }),
    };
  } catch (error) {
    if (error instanceof UsernameExistsException) {
      // The user already exists. We did NOT create it in this invocation, so
      // there is nothing to roll back and we must not delete a pre-existing
      // user. Return 409 without compensation.
      logger.warn('Invite failed — user already exists', { email });
      return {
        statusCode: 409,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          error: { code: 'USER_EXISTS', message: 'A user with this email already exists' },
        }),
      };
    }

    if (error instanceof NotAuthorizedException) {
      // Roll back any partial provisioning before returning.
      const { ok } = await compensate();
      if (!ok) {
        logger.error('Compensation incomplete after authorization failure — manual recovery may be required', { email, invitationId });
      }
      logger.warn('Invite failed — not authorized', { email });
      return {
        statusCode: 403,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          error: { code: 'FORBIDDEN', message: 'Not authorized to perform this action' },
        }),
      };
    }

    // Any other failure (e.g. AddToGroup error, or an ambiguous DynamoDB write
    // outcome): roll back the partially provisioned user AND any possibly
    // committed invitation record so state stays consistent and a retry is not
    // blocked by UsernameExistsException.
    const { ok: compensationOk } = await compensate();

    logger.error('Unexpected error during user invitation', {
      error: error instanceof Error ? error.message : String(error),
      email,
      invitationId,
      // Surface whether cleanup fully succeeded. When false, residual state may
      // remain and the operation is NOT guaranteed all-or-nothing.
      compensationComplete: compensationOk,
    });

    if (!compensationOk) {
      // Observable + recoverable: do not silently claim success/consistency.
      logger.error('Compensation incomplete — invited user and/or invitation record may require manual cleanup', {
        email,
        invitationId,
        tenantId,
      });
    }

    return {
      statusCode: 500,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        error: { code: 'INTERNAL_ERROR', message: 'An unexpected error occurred' },
      }),
    };
  }
}

// ---------------------------------------------------------------------------
// Middleware Stack
// ---------------------------------------------------------------------------

export const handler = middy(baseHandler)
  .use(
    rbacMiddleware({
      resource: 'users',
      action: 'invite',
    }),
  )
  .use(tenantContextMiddleware())
  .use(
    inputValidationMiddleware({
      schema: inviteUserSchema,
      source: 'body',
    }),
  );
