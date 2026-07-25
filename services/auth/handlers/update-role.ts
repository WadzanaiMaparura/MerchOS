/**
 * Update Role Lambda handler for PUT /auth/users/:id/role.
 *
 * Protected endpoint — requires owner role within the tenant.
 * Updates a user's role by modifying their Cognito group membership
 * and custom:role attribute.
 *
 * Requirements: FR-4
 */

import middy from '@middy/core';
import type { APIGatewayProxyEventV2, APIGatewayProxyResultV2 } from 'aws-lambda';
import {
  AdminListGroupsForUserCommand,
  AdminRemoveUserFromGroupCommand,
  AdminAddUserToGroupCommand,
  AdminUpdateUserAttributesCommand,
  UserNotFoundException,
} from '@aws-sdk/client-cognito-identity-provider';

import { updateRoleSchema } from '../schemas';
import { getCognitoClient } from '../utils/cognito-client';
import { emitAuthEvent } from '../utils/event-emitter';
import { inputValidationMiddleware } from '../../shared/middleware/input-validation';
import { rbacMiddleware } from '../../shared/middleware/rbac';
import { tenantContextMiddleware } from '../../shared/middleware/tenant-context';
import { logger } from '../../shared/middleware/powertools';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface UpdateRoleEvent extends APIGatewayProxyEventV2 {
  body: {
    role: string;
  };
}

// Cognito groups that correspond to seller roles
const SELLER_ROLE_GROUPS = new Set(['viewer', 'editor', 'admin', 'owner']);

// ---------------------------------------------------------------------------
// Handler
// ---------------------------------------------------------------------------

/**
 * Core update-role handler logic.
 *
 * 1. Validate requesting user has 'owner' role
 * 2. Prevent changing own role
 * 3. Get user's current groups via AdminListGroupsForUser
 * 4. Remove from old seller-role group
 * 5. Add to new role group
 * 6. Update custom:role attribute
 * 7. Emit auth.user.role-changed event
 */
async function baseHandler(event: UpdateRoleEvent): Promise<APIGatewayProxyResultV2> {
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

  const { role } = event.body;
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
  const requestingUserId = rbac?.['userId'] as string | undefined;

  // Prevent changing own role
  if (requestingUserId === targetUserId) {
    logger.warn('User attempted to change own role', { userId: targetUserId });
    return {
      statusCode: 400,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        error: { code: 'CANNOT_CHANGE_OWN_ROLE', message: 'Cannot change your own role' },
      }),
    };
  }

  const cognitoClient = getCognitoClient();

  try {
    // Step 1: Get user's current groups
    const groupsResponse = await cognitoClient.send(
      new AdminListGroupsForUserCommand({
        UserPoolId: userPoolId,
        Username: targetUserId,
      }),
    );

    // Step 2: Remove from old seller-role groups
    const currentGroups = groupsResponse.Groups ?? [];
    for (const group of currentGroups) {
      const groupName = group.GroupName?.toLowerCase();
      if (groupName && SELLER_ROLE_GROUPS.has(groupName)) {
        await cognitoClient.send(
          new AdminRemoveUserFromGroupCommand({
            UserPoolId: userPoolId,
            Username: targetUserId,
            GroupName: group.GroupName!,
          }),
        );
      }
    }

    // Step 3: Add to new role group
    await cognitoClient.send(
      new AdminAddUserToGroupCommand({
        UserPoolId: userPoolId,
        Username: targetUserId,
        GroupName: role,
      }),
    );

    // Step 4: Update custom:role attribute
    await cognitoClient.send(
      new AdminUpdateUserAttributesCommand({
        UserPoolId: userPoolId,
        Username: targetUserId,
        UserAttributes: [{ Name: 'custom:role', Value: role }],
      }),
    );

    const updatedAt = new Date().toISOString();

    // Step 5: Emit auth.user.role-changed event (fire-and-forget)
    emitAuthEvent({
      detailType: 'auth.user.role-changed',
      detail: {
        userId: targetUserId,
        newRole: role,
        changedBy: requestingUserId ?? 'unknown',
        timestamp: updatedAt,
      },
    }).catch((err) => {
      logger.error('Failed to emit auth.user.role-changed event', {
        error: err instanceof Error ? err.message : String(err),
      });
    });

    logger.info('User role updated successfully', { userId: targetUserId, role });

    return {
      statusCode: 200,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        userId: targetUserId,
        role,
        updatedAt,
      }),
    };
  } catch (error) {
    if (error instanceof UserNotFoundException) {
      logger.warn('Update role failed — user not found', { userId: targetUserId });
      return {
        statusCode: 404,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          error: { code: 'USER_NOT_FOUND', message: 'User not found' },
        }),
      };
    }

    logger.error('Unexpected error updating user role', {
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
      action: 'updateRole',
    }),
  )
  .use(tenantContextMiddleware())
  .use(
    inputValidationMiddleware({
      schema: updateRoleSchema,
      source: 'body',
    }),
  );
