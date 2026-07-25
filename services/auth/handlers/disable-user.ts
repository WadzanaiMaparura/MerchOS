/**
 * Disable User Lambda handler for POST /auth/users/:id/disable.
 *
 * Protected endpoint — requires admin role within the tenant.
 * Disables a Cognito user account, preventing them from signing in.
 *
 * Requirements: FR-4
 */

import middy from '@middy/core';
import type { APIGatewayProxyEventV2, APIGatewayProxyResultV2 } from 'aws-lambda';
import {
  AdminDisableUserCommand,
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
 * Core disable-user handler logic.
 *
 * 1. Extract target userId from path parameters
 * 2. Call Cognito AdminDisableUser
 * 3. Emit auth.user.disabled event
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
  const disabledBy = (rbac?.['userId'] as string) ?? 'unknown';

  const cognitoClient = getCognitoClient();

  try {
    // Disable the user in Cognito
    await cognitoClient.send(
      new AdminDisableUserCommand({
        UserPoolId: userPoolId,
        Username: targetUserId,
      }),
    );

    // Emit auth.user.disabled event (fire-and-forget)
    emitAuthEvent({
      detailType: 'auth.user.disabled',
      detail: {
        userId: targetUserId,
        disabledBy,
        timestamp: new Date().toISOString(),
      },
    }).catch((err) => {
      logger.error('Failed to emit auth.user.disabled event', {
        error: err instanceof Error ? err.message : String(err),
      });
    });

    logger.info('User disabled successfully', { userId: targetUserId, disabledBy });

    return {
      statusCode: 200,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        success: true,
        userId: targetUserId,
        disabled: true,
      }),
    };
  } catch (error) {
    if (error instanceof UserNotFoundException) {
      logger.warn('Disable user failed — user not found', { userId: targetUserId });
      return {
        statusCode: 404,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          error: { code: 'USER_NOT_FOUND', message: 'User not found' },
        }),
      };
    }

    logger.error('Unexpected error disabling user', {
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
      action: 'disable',
    }),
  )
  .use(tenantContextMiddleware());
