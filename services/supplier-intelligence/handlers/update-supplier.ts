/**
 * Update Supplier Lambda handler for PUT /suppliers/{supplierId}.
 *
 * Updates an existing supplier profile with version increment and snapshot
 * preservation. Before applying the update, the current version is stored
 * as a version history record with SK `SUPPLIER#{supplierId}#VERSION#{version}`.
 * On success, emits a `SupplierProfileChanged` event to EventBridge.
 *
 * Requirements: 1.2, 1.3, 1.5, 12.3
 */

import middy from '@middy/core';
import type { APIGatewayProxyEventV2, APIGatewayProxyResultV2 } from 'aws-lambda';
import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import {
  DynamoDBDocumentClient,
  GetCommand,
  TransactWriteCommand,
} from '@aws-sdk/lib-dynamodb';
import {
  EventBridgeClient,
  PutEventsCommand,
} from '@aws-sdk/client-eventbridge';

import { updateSupplierSchema } from '../schemas/supplier.schema';
import type { UpdateSupplierInput } from '../schemas/supplier.schema';
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

interface UpdateSupplierEvent extends Omit<APIGatewayProxyEventV2, 'body'> {
  body: UpdateSupplierInput;
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
 * Core handler logic for updating a supplier profile.
 *
 * 1. Extract tenantId from authorizer context
 * 2. Fetch the current supplier record from DynamoDB
 * 3. Store a snapshot of the current version as a version history item
 *    (SK: SUPPLIER#{supplierId}#VERSION#{currentVersion})
 * 4. Apply the update with incremented version number
 * 5. Use transactWrite for atomicity
 * 6. Emit SupplierProfileChanged event to EventBridge
 * 7. Return the updated supplier
 */
async function baseHandler(event: UpdateSupplierEvent): Promise<APIGatewayProxyResultV2> {
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

  const supplierId = event.pathParameters?.['supplierId'];

  if (!supplierId) {
    return {
      statusCode: 400,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        error: { code: 'INVALID_REQUEST', message: 'Missing supplierId path parameter' },
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

  const updatePayload = event.body;
  const docClient = getDynamoDocClient();
  const pk = `TENANT#${tenantId}`;
  const sk = `SUPPLIER#${supplierId}`;

  try {
    // Step 1: Fetch the current supplier record
    const getResult = await docClient.send(
      new GetCommand({
        TableName: suppliersTable,
        Key: { PK: pk, SK: sk },
      }),
    );

    if (!getResult.Item) {
      logger.info('Supplier not found for update', { supplierId, tenantId });
      return {
        statusCode: 404,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          error: { code: 'NOT_FOUND', message: `Supplier ${supplierId} not found` },
        }),
      };
    }

    // Extract supplier data (exclude DynamoDB key/GSI attributes)
    const { PK, SK, GSI1PK, GSI1SK, ...currentSupplierData } = getResult.Item;
    const currentSupplier = currentSupplierData as unknown as SupplierProfile;
    const currentVersion = currentSupplier.version;
    const newVersion = currentVersion + 1;
    const now = new Date().toISOString();

    // Step 2: Build the updated supplier record (merge update fields)
    const updatedSupplier: SupplierProfile = {
      ...currentSupplier,
      ...(updatePayload.name !== undefined && { name: updatePayload.name }),
      ...(updatePayload.contactEmail !== undefined && { contactEmail: updatePayload.contactEmail }),
      ...(updatePayload.contactPhone !== undefined && { contactPhone: updatePayload.contactPhone }),
      ...(updatePayload.website !== undefined && { website: updatePayload.website }),
      ...(updatePayload.notes !== undefined && { notes: updatePayload.notes }),
      ...(updatePayload.duplicateStrategy !== undefined && { duplicateStrategy: updatePayload.duplicateStrategy }),
      version: newVersion,
      updatedAt: now,
    };

    // Step 3: Store version snapshot and update current record atomically
    const versionSnapshotSK = `SUPPLIER#${supplierId}#VERSION#${currentVersion}`;

    await docClient.send(
      new TransactWriteCommand({
        TransactItems: [
          {
            // Store snapshot of the previous version
            Put: {
              TableName: suppliersTable,
              Item: {
                PK: pk,
                SK: versionSnapshotSK,
                supplierId,
                tenantId,
                version: currentVersion,
                snapshot: currentSupplier,
                createdAt: now,
              },
              // Ensure we don't overwrite an existing version snapshot
              ConditionExpression: 'attribute_not_exists(SK)',
            },
          },
          {
            // Update the current supplier record with new version
            Put: {
              TableName: suppliersTable,
              Item: {
                PK: pk,
                SK: sk,
                GSI1PK: pk,
                GSI1SK: `SUPPLIER#CREATED#${updatedSupplier.createdAt}`,
                ...updatedSupplier,
              },
              // Ensure the record exists and version hasn't changed (optimistic locking)
              ConditionExpression: 'attribute_exists(SK) AND version = :currentVersion',
              ExpressionAttributeValues: {
                ':currentVersion': currentVersion,
              },
            },
          },
        ],
      }),
    );

    logger.info('Supplier updated successfully', {
      supplierId,
      tenantId,
      previousVersion: currentVersion,
      newVersion,
    });

    // Step 4: Emit SupplierProfileChanged event (fire-and-forget)
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
                  version: newVersion,
                  action: 'UPDATED',
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
      statusCode: 200,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ supplier: updatedSupplier }),
    };
  } catch (error) {
    // Handle optimistic locking conflict
    if (
      error instanceof Error &&
      error.name === 'TransactionCanceledException'
    ) {
      logger.warn('Supplier update conflict — version mismatch', {
        supplierId,
        tenantId,
      });
      return {
        statusCode: 409,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          error: {
            code: 'VERSION_CONFLICT',
            message: 'Supplier was modified by another request. Please retry.',
          },
        }),
      };
    }

    logger.error('Error updating supplier', {
      error: error instanceof Error ? error.message : String(error),
      supplierId,
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
      action: 'update',
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
      schema: updateSupplierSchema,
      source: 'body',
    }),
  );
