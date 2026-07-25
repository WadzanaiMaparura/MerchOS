/**
 * Delete User Lambda handler for DELETE /auth/users/:id.
 *
 * Protected endpoint — requires owner role within the tenant.
 * Permanently deletes a Cognito user account. Owners cannot be deleted
 * to prevent tenant orphaning.
 *
 * Requirements: FR-4
 */

import middy from '@middy/core';
import type { APIGatewayProxyEventV2, APIGatewayProxyResultV2 } from 'aws-lambda';
import {
  AdminDeleteUserCommand,
  AdminGetUserCommand,
  UserNotFoundException,
} from '@aws-sdk/client-cognito-identity-provider';

import { getCognitoClient } from '../utils/cognito-client';
import { emitAuthEvent } from '../utils/event-emitter';
import { rbacMiddleware } from '../../shared/middleware/rbac';
import { tenantContextMiddleware } from '../../shared/middleware/tenant-context';
import { logger } from '../../shared/middleware/powertools';

// ---------------------------------------------------------------------------
// Handler
// ---------------------------------------------------------------------------

/**
 * Core delete-user handler logic.
 *
 * 1. Extract target userId from path parameters
 * 2. Check user is not an owner (prevent owner deletion)
 * 3. Call Cognito AdminDeleteUser
 * 4. Emit auth.user.deleted event
 */
async function baseHandler(event: APIGatewayProxyEventV2): Promise<APIGatewayProxyResultV2> {
  const userPoolId = process.env['COGNITO_TENANT_POOL_ID'];

  if (!userPoolId) {
    logger.error('Missing required environment variable COGNITO_TENANT_POOL_ID');
    return {
      statusCode: 500,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        error: { code: 'INTERNAL_ERROR', message: 'Service misconfigured' },
      }),
    };
  }

  const targetUserId = event.pathParameters?.['id'];

  if (!targetUserId) {
    return {
      statusCode: 400,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        error: { code: 'VALIDATION_ERROR', message: 'User ID is required' },
      }),
    };
  }

  // Extract requesting user from authorizer context
  const requestContext = event.requestContext as unknown as Record<string, unknown>;
  const authorizer = requestContext?.['authorizer'] as Record<string, unknown> | undefined;
  const rbac = authorizer?.['rbac'] as Record<string, unknown> | undefined;
  const deletedBy = (rbac?.['userId'] as string) ?? 'unknown';

  const cognitoClient = getCognitoClient();

  try {
    // Step 1: Check if target user is an owner (prevent owner deletion)
    const getUserResponse = await cognitoClient.send(
      new AdminGetUserCommand({
        UserPoolId: userPoolId,
        Username: targetUserId,
      }),
    );

    const targetRole = getUserResponse.UserAttributes?.find(
      (attr) => attr.Name === 'custom:role',
    )?.Value;

    if (targetRole === 'owner') {
      logger.warn('Attempted to delete owner user', { userId: targetUserId });
      return {
        statusCode: 403,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          error: { code: 'CANNOT_DELETE_OWNER', message: 'Cannot delete a user with owner role' },
        }),
      };
    }

    // Step 2: Delete the user from Cognito
    await cognitoClient.send(
      new AdminDeleteUserCommand({
        UserPoolId: userPoolId,
        Username: targetUserId,
      }),
    );

    // Step 3: Emit auth.user.deleted event (fire-and-forget)
    emitAuthEvent({
      detailType: 'auth.user.deleted',
      detail: {
        userId: targetUserId,
        deletedBy,
        timestamp: new Date().toISOString(),
      },
    }).catch((err) => {
      logger.error('Failed to emit auth.user.deleted event', {
        error: err instanceof Error ? err.message : String(err),
      });
    });

    logger.info('User deleted successfully', { userId: targetUserId, deletedBy });

    return {
      statusCode: 200,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        success: true,
        userId: targetUserId,
      }),
    };
  } catch (error) {
    if (error instanceof UserNotFoundException) {
      logger.warn('Delete user failed — user not found', { userId: targetUserId });
      return {
        statusCode: 404,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          error: { code: 'USER_NOT_FOUND', message: 'User not found' },
        }),
      };
    }

    logger.error('Unexpected error deleting user', {
      error: error instanceof Error ? error.message : String(error),
      userId: targetUserId,
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
      action: 'delete',
    }),
  )
  .use(tenantContextMiddleware());
