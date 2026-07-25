/**
 * Cognito PostConfirmation Lambda trigger for MerchOS.
 *
 * Handles post-confirmation logic:
 * 1. Extracts tenantId and email from user attributes
 * 2. If this is a new tenant (self sign-up), creates a tenant record in DynamoDB
 * 3. Emits auth.user.registered event via EventBridge
 *
 * Requirements: FR-3.1, FR-3.2
 */

import type { PostConfirmationTriggerEvent } from 'aws-lambda';
import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { DynamoDBDocumentClient, PutCommand, GetCommand } from '@aws-sdk/lib-dynamodb';
import { Logger } from '@aws-lambda-powertools/logger';

import { emitAuthEvent } from '../utils/event-emitter';

// ---------------------------------------------------------------------------
// Logger
// ---------------------------------------------------------------------------

const logger = new Logger({ serviceName: 'merch-os-post-confirmation' });

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
 * Cognito PostConfirmation trigger handler.
 *
 * Creates a tenant record in DynamoDB for self sign-ups (new tenants)
 * and emits a user.registered event to EventBridge.
 */
export async function handler(
  event: PostConfirmationTriggerEvent,
): Promise<PostConfirmationTriggerEvent> {
  const email = event.request.userAttributes['email'] ?? '';
  const tenantId = event.request.userAttributes['custom:tenantId'] ?? '';
  const userId = event.userName;

  logger.info('PostConfirmation trigger invoked', {
    email,
    tenantId,
    userId,
    triggerSource: event.triggerSource,
  });

  try {
    const tenantsTable = process.env['TENANTS_TABLE'];

    if (!tenantsTable) {
      logger.error('TENANTS_TABLE environment variable is not set');
      return event;
    }

    if (!tenantId) {
      logger.warn('No tenantId found in user attributes, skipping tenant creation');
      return event;
    }

    const docClient = getDynamoDocClient();

    // Check if this is a new tenant (self sign-up) — tenant record doesn't exist yet
    const existing = await docClient.send(
      new GetCommand({
        TableName: tenantsTable,
        Key: {
          PK: `TENANT#${tenantId}`,
          SK: 'METADATA',
        },
      }),
    );

    if (!existing.Item) {
      // New tenant — create the tenant record
      const tenantName = email.split('@')[0] ?? 'Unknown';

      await docClient.send(
        new PutCommand({
          TableName: tenantsTable,
          Item: {
            PK: `TENANT#${tenantId}`,
            SK: 'METADATA',
            name: tenantName,
            createdAt: new Date().toISOString(),
            status: 'active',
          },
          ConditionExpression: 'attribute_not_exists(PK)',
        }),
      );

      logger.info('Tenant record created', { tenantId, name: tenantName });
    } else {
      logger.info('Tenant already exists, skipping creation', { tenantId });
    }

    // Emit auth.user.registered event
    await emitAuthEvent({
      detailType: 'auth.user.registered',
      detail: {
        userId,
        email,
        tenantId,
        timestamp: new Date().toISOString(),
      },
    });

    logger.info('auth.user.registered event emitted', { userId, tenantId });
  } catch (error) {
    // Log error but don't block confirmation — return event as-is
    logger.error('Error in PostConfirmation trigger', {
      error: error instanceof Error ? error.message : String(error),
      email,
      tenantId,
    });
  }

  return event;
}
