/**
 * Pending-registration repository (Stage B — reconciliation consumer side).
 *
 * Narrowly scoped repository that reads and consumes the short-lived
 * pending-registration record written at sign-up time. The record key is
 * PK=PENDINGREG#<registrationId>, SK=META and carries the business details
 * (organisation name, full name, phone, consent) plus the email the pending
 * registration was created for and an `expiresAt` epoch-seconds TTL.
 *
 * Access is by PRIMARY KEY ONLY (GetItem / DeleteItem). This module performs no
 * table scan and relies on no secondary index.
 *
 * IMPORTANT: like registration-persistence.ts this intentionally does NOT use
 * TenantDynamoClient. That wrapper injects a `PK = :callerTenantPK` condition on
 * every write, which is incompatible with the cross-partition PENDINGREG# key
 * (there is no tenant context at reconciliation time — the tenant is derived
 * from Cognito). TenantDynamoClient is left entirely unchanged; this repository
 * uses the raw DynamoDBDocumentClient with explicit, hand-written conditions.
 */

import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import {
  DynamoDBDocumentClient,
  GetCommand,
  DeleteCommand,
} from '@aws-sdk/lib-dynamodb';

import type { PendingRegistrationRecord } from '../../shared/types/registration.types';

// ---------------------------------------------------------------------------
// Client (singleton)
// ---------------------------------------------------------------------------

let docClient: DynamoDBDocumentClient | null = null;

function getDocClient(): DynamoDBDocumentClient {
  if (!docClient) {
    const client = new DynamoDBClient({
      region: process.env['AWS_REGION'] ?? 'eu-west-1',
    });
    docClient = DynamoDBDocumentClient.from(client, {
      marshallOptions: { removeUndefinedValues: true },
    });
  }
  return docClient;
}

/** Test seam — reset the memoised client between unit tests. */
export function resetPendingRegistrationRepositoryClient(): void {
  docClient = null;
}

// ---------------------------------------------------------------------------
// Keys
// ---------------------------------------------------------------------------

/** Partition key for a pending-registration record: `PENDINGREG#<registrationId>`. */
export function pendingRegistrationPK(registrationId: string): string {
  return `PENDINGREG#${registrationId}`;
}

/** The single sort key value for a pending-registration record. */
export const PENDING_REGISTRATION_SK = 'META' as const;

// ---------------------------------------------------------------------------
// Read
// ---------------------------------------------------------------------------

/**
 * Fetch the pending-registration record by its server-issued registration id.
 * Returns undefined when no record exists (missing or already consumed, or
 * asynchronously TTL-expired and deleted).
 *
 * Primary-key GetItem only — no scan, no index.
 */
export async function getPendingRegistration(
  tableName: string,
  registrationId: string,
): Promise<PendingRegistrationRecord | undefined> {
  const result = await getDocClient().send(
    new GetCommand({
      TableName: tableName,
      Key: { PK: pendingRegistrationPK(registrationId), SK: PENDING_REGISTRATION_SK },
      // Reconciliation must act on the authoritative committed record.
      ConsistentRead: true,
    }),
  );
  return result.Item as PendingRegistrationRecord | undefined;
}

/**
 * Returns true when a pending record is expired per application logic.
 *
 * `expiresAt` is epoch SECONDS. Expiry is enforced here in code and never
 * relies solely on DynamoDB's asynchronous TTL deletion (which can lag by many
 * minutes). A record whose TTL has lapsed must be treated as expired even if it
 * is still physically present.
 */
export function isPendingRegistrationExpired(
  record: Pick<PendingRegistrationRecord, 'expiresAt'>,
  nowEpochSeconds: number = Math.floor(Date.now() / 1000),
): boolean {
  return typeof record.expiresAt !== 'number' || record.expiresAt <= nowEpochSeconds;
}

// ---------------------------------------------------------------------------
// Consume (best-effort cleanup after a successful, idempotent persist)
// ---------------------------------------------------------------------------

/**
 * Delete the pending-registration record after the owner profile has been
 * durably persisted. This is a cleanup step, not the idempotency guard: the
 * idempotency guarantee lives in completeOwnerProfile (attribute_not_exists on
 * the tenant/owner/consent SKs), so a duplicate delivery that races this delete
 * can never create duplicate tenants/owners/consents.
 *
 * The conditional delete (attribute_exists(PK)) makes the delete a no-op if the
 * record was already removed by a concurrent delivery, so a duplicate does not
 * raise a spurious error. Any other DynamoDB error is surfaced to the caller,
 * which treats cleanup failure as non-fatal (the TTL remains as a backstop).
 */
export async function deletePendingRegistration(
  tableName: string,
  registrationId: string,
): Promise<void> {
  try {
    await getDocClient().send(
      new DeleteCommand({
        TableName: tableName,
        Key: { PK: pendingRegistrationPK(registrationId), SK: PENDING_REGISTRATION_SK },
        ConditionExpression: 'attribute_exists(PK)',
      }),
    );
  } catch (err) {
    // A concurrent delivery already deleted it — not an error for us.
    if ((err as { name?: string })?.name === 'ConditionalCheckFailedException') {
      return;
    }
    throw err;
  }
}
