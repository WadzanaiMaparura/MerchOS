/**
 * Create Supplier Lambda handler for POST /suppliers.
 *
 * Protected endpoint — requires 'supplier:manage' permission within the tenant.
 * Creates a new supplier profile record scoped to the seller's tenant,
 * stores it in DynamoDB, and emits a SupplierProfileChanged event to EventBridge.
 *
 * Requirements: 1.1, 1.5, 12.1, 12.2, 12.3, 12.4, 12.5
 */

import middy from '@middy/core';
import crypto from 'node:crypto';
import type { APIGatewayProxyEventV2, APIGatewayProxyResultV2 } from 'aws-lambda';
import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { DynamoDBDocumentClient, PutCommand } from '@aws-sdk/lib-dynamodb';
import {
  EventBridgeClient,
  PutEventsCommand,
} from '@aws-sdk/client-eventbridge';

import { createSupplierSchema } from '../schemas/supplier.schema';
import type { CreateSupplierInput } from '../schemas/supplier.schema';
import type { SupplierProfile } from '../types/supplier.types';
import { SUPPLIER_INTELLIGENCE_EVENT_SOURCE } from '../types/events.types';
import { rbacMiddleware } from '../../shared/middleware/rbac';
import { tenantContextMiddleware } from '../../shared/middleware/tenant-context';
import { rateLimitMiddleware } from '../../shared/middleware/rate-limit';
import { inputValidationMiddleware } from '../../shared/middleware/input-validation';
import { logger } from '../../shared/middleware/powertools';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface CreateSupplierEvent extends Omit<APIGatewayProxyEventV2, 'body'> {
  body: CreateSupplierInput;
}

// ---------------------------------------------------------------------------
// Clients (singletons)
// ---------------------------------------------------------------------------

let ddbDocClient: DynamoDBDocumentClient | null = null;
let eventBridgeClient: EventBridgeClient | null = null;

function getDynamoDocClient(): DynamoDBDocumentClient {
  if (!ddbDocClient) {
    const client = new DynamoDBClient({
      region: process.env['AWS_REGION'] ?? 'af-south-1',
    });
    ddbDocClient = DynamoDBDocumentClient.from(client);
  }
  return ddbDocClient;
}

function getEventBridgeClient(): EventBridgeClient {
  if (!eventBridgeClient) {
    eventBridgeClient = new EventBridgeClient({
      region: process.env['AWS_REGION'] ?? 'af-south-1',
    });
  }
  return eventBridgeClient;
}

// ---------------------------------------------------------------------------
// Handler
// ---------------------------------------------------------------------------

/**
 * Core create-supplier handler logic.
 *
 * 1. Extract tenantId from authorizer context
 * 2. Generate supplier ID and timestamps
 * 3. Store supplier profile in DynamoDB (PK: TENANT#{tenantId}, SK: SUPPLIER#{supplierId})
 * 4. Emit SupplierProfileChanged event to EventBridge
 * 5. Return 201 with created supplier record
 */
async function baseHandler(event: CreateSupplierEvent): Promise<APIGatewayProxyResultV2> {
  const suppliersTable = process.env['SUPPLIERS_TABLE'];
  const eventBusName = process.env['EVENT_BUS_NAME'];

  if (!suppliersTable) {
    logger.error('Missing required environment variable SUPPLIERS_TABLE');
    return {
      statusCode: 500,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        error: { code: 'INTERNAL_ERROR', message: 'Service misconfigured' },
      }),
    };
  }

  // Extract tenantId from the tenant context middleware
  const requestContext = event.requestContext as unknown as Record<string, unknown>;
  const authorizer = requestContext?.['authorizer'] as Record<string, unknown> | undefined;
  const tenantContext = authorizer?.['tenantContext'] as
    | { tenantId: string }
    | undefined;

  const tenantId = tenantContext?.tenantId;

  if (!tenantId) {
    logger.error('Missing tenant context — tenantContextMiddleware may not have run');
    return {
      statusCode: 401,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        error: { code: 'MISSING_TENANT', message: 'Tenant context required' },
      }),
    };
  }

  // Generate supplier identity and timestamps
  const supplierId = crypto.randomUUID();
  const now = new Date().toISOString();

  // Build the supplier profile record
  const supplierProfile: SupplierProfile = {
    supplierId,
    tenantId,
    name: event.body.name,
    ...(event.body.contactEmail !== undefined && { contactEmail: event.body.contactEmail }),
    ...(event.body.contactPhone !== undefined && { contactPhone: event.body.contactPhone }),
    ...(event.body.website !== undefined && { website: event.body.website }),
    ...(event.body.notes !== undefined && { notes: event.body.notes }),
    duplicateStrategy: event.body.duplicateStrategy,
    version: 1,
    createdAt: now,
    updatedAt: now,
  };

  try {
    // Store supplier profile in DynamoDB
    const docClient = getDynamoDocClient();

    await docClient.send(
      new PutCommand({
        TableName: suppliersTable,
        Item: {
          PK: `TENANT#${tenantId}`,
          SK: `SUPPLIER#${supplierId}`,
          GSI1PK: `TENANT#${tenantId}`,
          GSI1SK: `SUPPLIER#CREATED#${now}`,
          ...supplierProfile,
        },
      }),
    );

    logger.info('Supplier profile created', { supplierId, tenantId });

    // Emit SupplierProfileChanged event (fire-and-forget)
    if (eventBusName) {
      const ebClient = getEventBridgeClient();

      ebClient
        .send(
          new PutEventsCommand({
            Entries: [
              {
                Source: SUPPLIER_INTELLIGENCE_EVENT_SOURCE,
                DetailType: 'SupplierProfileChanged',
                Detail: JSON.stringify({
                  tenantId,
                  supplierId,
                  version: 1,
                  action: 'CREATED',
                }),
                EventBusName: eventBusName,
                Time: new Date(),
              },
            ],
          }),
        )
        .catch((err) => {
          logger.error('Failed to emit SupplierProfileChanged event', {
            error: err instanceof Error ? err.message : String(err),
            supplierId,
          });
        });
    } else {
      logger.warn('EVENT_BUS_NAME not set — skipping event emission', { supplierId });
    }

    return {
      statusCode: 201,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(supplierProfile),
    };
  } catch (error) {
    logger.error('Unexpected error creating supplier profile', {
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
      resource: 'supplier',
      action: 'create',
    }),
  )
  .use(tenantContextMiddleware())
  .use(
    rateLimitMiddleware({
      maxRequests: 100,
      windowSeconds: 60,
    }),
  )
  .use(
    inputValidationMiddleware({
      schema: createSupplierSchema,
      source: 'body',
    }),
  );
