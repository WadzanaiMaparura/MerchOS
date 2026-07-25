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

import crypto from 'node:crypto';
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
      region: process.env['AWS_REGION'] ?? 'af-south-1',
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
 * Queries the invitations table for a pending invitation matching the email.
 * Uses the email-index GSI to look up invitations by email address.
 */
async function findPendingInvitation(
  email: string,
): Promise<InvitationRecord | null> {
  const invitationsTable = process.env['INVITATIONS_TABLE'];
  if (!invitationsTable) {
    logger.warn('INVITATIONS_TABLE not configured, skipping invitation check');
    return null;
  }

  const docClient = getDynamoDocClient();

  try {
    const result = await docClient.send(
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

    if (result.Items && result.Items.length > 0) {
      return result.Items[0] as InvitationRecord;
    }

    return null;
  } catch (error) {
    logger.error('Failed to query invitations table', {
      error: error instanceof Error ? error.message : String(error),
      email,
    });
    return null;
  }
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

  try {
    // Check if user was invited
    const invitation = await findPendingInvitation(email);

    if (invitation) {
      // Invited user: auto-confirm and assign invited role/tenant
      logger.info('User was invited, auto-confirming', {
        email,
        tenantId: invitation.tenantId,
        role: invitation.role,
      });

      event.response.autoConfirmUser = true;
      event.response.autoVerifyEmail = true;

      // Set custom attributes on request.userAttributes (Cognito persists these)
      event.request.userAttributes['custom:tenantId'] = invitation.tenantId;
      event.request.userAttributes['custom:role'] = invitation.role;
    } else {
      // Self sign-up: generate new tenant
      const tenantId = crypto.randomUUID();

      logger.info('Self sign-up, generating new tenantId', {
        email,
        tenantId,
      });

      // Set custom attributes on request.userAttributes (Cognito persists these)
      event.request.userAttributes['custom:tenantId'] = tenantId;
      event.request.userAttributes['custom:role'] = 'owner';
    }
  } catch (error) {
    // Log error but don't block sign-up: return event as-is
    logger.error('Error in PreSignUp trigger', {
      error: error instanceof Error ? error.message : String(error),
      email,
    });
  }

  return event;
}
