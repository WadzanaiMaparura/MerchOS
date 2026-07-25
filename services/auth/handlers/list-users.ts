/**
 * List Users Lambda handler for GET /auth/users.
 *
 * Protected endpoint — requires admin role within the tenant.
 * Lists Cognito users in the 'Seller' group filtered by tenantId,
 * with pagination support via PaginationToken.
 *
 * Requirements: FR-4
 */

import middy from '@middy/core';
import type { APIGatewayProxyEventV2, APIGatewayProxyResultV2 } from 'aws-lambda';
import {
  ListUsersInGroupCommand,
  type UserType,
} from '@aws-sdk/client-cognito-identity-provider';

import { listUsersQuerySchema } from '../schemas';
import { getCognitoClient } from '../utils/cognito-client';
import { inputValidationMiddleware } from '../../shared/middleware/input-validation';
import { rbacMiddleware } from '../../shared/middleware/rbac';
import { tenantContextMiddleware } from '../../shared/middleware/tenant-context';
import { logger } from '../../shared/middleware/powertools';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface ListUsersEvent extends APIGatewayProxyEventV2 {
  queryStringParameters: {
    tenantId: string;
    limit: number;
    nextToken?: string;
  };
}

interface UserResponse {
  userId: string;
  email: string;
  role: string;
  tenantId: string;
  status: string;
  createdAt: string;
}

// ---------------------------------------------------------------------------
// Handler
// ---------------------------------------------------------------------------

/**
 * Core list-users handler logic.
 *
 * 1. Calls Cognito ListUsersInGroup for 'Seller' group
 * 2. Filters results by tenantId matching the requesting user's tenantId
 * 3. Returns paginated user list
 */
async function baseHandler(event: ListUsersEvent): Promise<APIGatewayProxyResultV2> {
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

  const { tenantId, limit, nextToken } = event.queryStringParameters;
  const cognitoClient = getCognitoClient();

  try {
    const command = new ListUsersInGroupCommand({
      UserPoolId: userPoolId,
      GroupName: 'Seller',
      Limit: limit,
      NextToken: nextToken,
    });

    const response = await cognitoClient.send(command);

    // Filter users by tenantId
    const filteredUsers: UserResponse[] = (response.Users ?? [])
      .filter((user: UserType) => {
        const userTenantId = user.Attributes?.find(
          (attr) => attr.Name === 'custom:tenantId',
        )?.Value;
        return userTenantId === tenantId;
      })
      .map((user: UserType) => {
        const attrs = user.Attributes ?? [];
        const getAttr = (name: string) =>
          attrs.find((a) => a.Name === name)?.Value ?? '';

        return {
          userId: user.Username ?? '',
          email: getAttr('email'),
          role: getAttr('custom:role'),
          tenantId: getAttr('custom:tenantId'),
          status: user.UserStatus ?? 'UNKNOWN',
          createdAt: user.UserCreateDate?.toISOString() ?? '',
        };
      });

    logger.info('Users listed successfully', {
      tenantId,
      count: filteredUsers.length,
    });

    return {
      statusCode: 200,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        users: filteredUsers,
        ...(response.NextToken && { nextToken: response.NextToken }),
      }),
    };
  } catch (error) {
    logger.error('Unexpected error listing users', {
      error: error instanceof Error ? error.message : String(error),
      tenantId,
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
      action: 'list',
    }),
  )
  .use(tenantContextMiddleware())
  .use(
    inputValidationMiddleware({
      schema: listUsersQuerySchema,
      source: 'queryStringParameters',
    }),
  );
