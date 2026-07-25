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
  AdminUpdateUserAttributesCommand,
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
      region: process.env['AWS_REGION'] ?? 'af-south-1',
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
 * 1. Generate secure invitation token
 * 2. Create Cognito user with suppressed default email
 * 3. Add user to 'Seller' Cognito group
 * 4. Set custom attributes (tenantId, role)
 * 5. Store invitation record in DynamoDB
 * 6. Emit auth.user.invited event
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
  const expiresAt = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString(); // 7 days

  try {
    // Step 1: Create Cognito user (suppress default welcome email)
    await cognitoClient.send(
      new AdminCreateUserCommand({
        UserPoolId: userPoolId,
        Username: email,
        MessageAction: 'SUPPRESS',
        UserAttributes: [
          { Name: 'email', Value: email },
          { Name: 'email_verified', Value: 'true' },
        ],
      }),
    );

    // Step 2: Add user to 'Seller' group
    await cognitoClient.send(
      new AdminAddUserToGroupCommand({
        UserPoolId: userPoolId,
        Username: email,
        GroupName: 'Seller',
      }),
    );

    // Step 3: Set custom attributes (tenantId, role)
    await cognitoClient.send(
      new AdminUpdateUserAttributesCommand({
        UserPoolId: userPoolId,
        Username: email,
        UserAttributes: [
          { Name: 'custom:tenantId', Value: tenantId },
          { Name: 'custom:role', Value: role },
        ],
      }),
    );

    // Step 4: Store invitation record in DynamoDB
    const invitationId = crypto.randomUUID();
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
          expiresAt,
          createdAt: new Date().toISOString(),
        },
      }),
    );

    // Step 5: Emit auth.user.invited event (fire-and-forget)
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
        expiresAt,
      }),
    };
  } catch (error) {
    if (error instanceof UsernameExistsException) {
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
      logger.warn('Invite failed — not authorized', { email });
      return {
        statusCode: 403,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          error: { code: 'FORBIDDEN', message: 'Not authorized to perform this action' },
        }),
      };
    }

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
