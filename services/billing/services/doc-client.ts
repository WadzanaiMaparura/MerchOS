/**
 * Shared DynamoDB DocumentClient for billing code that must touch items OUTSIDE
 * a single tenant partition (global counters). Tenant-owned data keeps going
 * through TenantDynamoClient, which enforces isolation; use this only for the
 * non-tenant items called out in each module.
 */
import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { DynamoDBDocumentClient } from '@aws-sdk/lib-dynamodb';

let client: DynamoDBDocumentClient | undefined;

export function getDocClient(): DynamoDBDocumentClient {
  client ??= DynamoDBDocumentClient.from(new DynamoDBClient({}), {
    marshallOptions: { removeUndefinedValues: true },
  });
  return client;
}

/** Test seam. */
export function setDocClient(c: DynamoDBDocumentClient | undefined): void {
  client = c;
}
