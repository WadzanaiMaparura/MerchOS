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
import { DynamoDBDocumentClient, PutCommand } from '@aws-sdk/lib-dynamodb';

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
 */
async function baseHandler(event: InviteUserEvent): Promise<APIGatewayProxyResultV2> {
  const { email, role, tenantId } = event.body;

  const userPoolId = process.env['COGNITO_TENANT_POOL_ID'];
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

  const compensate = async (): Promise<void> => {
    // Best-effort rollback of a partially provisioned user. Each step is
    // guarded so one cleanup failure does not mask the original error.
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
        logger.error('Compensation: failed to remove user from group', {
          email,
          error: err instanceof Error ? err.message : String(err),
        });
      }
    }
    if (userCreated) {
      try {
        await cognitoClient.send(
          new AdminDeleteUserCommand({ UserPoolId: userPoolId, Username: email }),
        );
      } catch (err) {
        logger.error('Compensation: failed to delete partially provisioned user', {
          email,
          error: err instanceof Error ? err.message : String(err),
        });
      }
    }
  };

  try {
    // Step 1: Create the Cognito user with the authoritative identity set AT
    // creation. The immutable custom:tenantId can ONLY be populated here (AWS
    // forbids updating it afterwards), so tenantId and role are supplied as
    // initial UserAttributes rather than via a later AdminUpdateUserAttributes.
    // We do NOT rely on the PreSignUp trigger mutating request.userAttributes.
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
    // group so a retry is not blocked by UsernameExistsException.
    const docClient = getDynamoDocClient();
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
      await compensate();
      logger.warn('Invite failed — not authorized', { email });
      return {
        statusCode: 403,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          error: { code: 'FORBIDDEN', message: 'Not authorized to perform this action' },
        }),
      };
    }

    // Any other failure (e.g. AddToGroup error, DynamoDB write failure): roll
    // back the partially provisioned user so state stays consistent and a retry
    // is not blocked by UsernameExistsException.
    await compensate();

    logger.error('Unexpected error during user invitation', {
      error: error instanceof Error ? error.message : String(error),
      email,
    });

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
