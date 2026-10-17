/**
 * Registration-completion repository.
 *
 * Commits the DURABLE registration records that complete a self-signup once
 * the Cognito account is verified and identity is assigned. It promotes the
 * server-trusted details captured on the pending record into three permanent,
 * tenant-scoped records in the existing tenants table, following the platform's
 * single-table conventions (PK = `TENANT#<tenantId>`):
 *
 *   SK = `METADATA`         -> tenant metadata
 *   SK = `PROFILE#<userId>` -> owner profile
 *   SK = `CONSENT#<userId>` -> marketing-consent record
 *
 * Design guarantees:
 *   - IDEMPOTENT + ATOMIC: all three records are written in a single
 *     TransactWriteItems with per-item `attribute_not_exists` conditions, so a
 *     retry of an already-completed registration neither duplicates records nor
 *     half-writes them. A conflict (records already exist) is reported back as
 *     `alreadyCompleted` rather than thrown, so the caller can treat a retry as
 *     success and proceed to cleanup.
 *   - SERVER-TRUSTED IDENTITY: the tenantId is the server-generated id recovered
 *     from the pending record and the userId is the verified Cognito identity.
 *     No client-supplied tenant id or role is ever used; the role is fixed to
 *     'owner' for a self-signup.
 *   - TTL-SAFE: none of the durable records carry `expiresAt`, so they are
 *     never TTL-expired (unlike the PENDINGREG#<id> record).
 *
 * This is deliberately a raw-document-client repository (like the pending
 * repository) rather than TenantDynamoClient: the transactional idempotency
 * conditions here are keyed on the exact PK+SK of records being CREATED, which
 * is clearer expressed explicitly than through the tenant-isolation wrapper.
 * The tenantId used is server-generated and never attacker-influenced.
 */

import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import {
  DynamoDBDocumentClient,
  TransactWriteCommand,
} from '@aws-sdk/lib-dynamodb';
import { TransactionCanceledException } from '@aws-sdk/client-dynamodb';

import { tenantPK, userSK } from '../../shared/utils/dynamo-client';
import type {
  CompleteRegistrationInput,
  TenantMetadataRecord,
  OwnerProfileRecord,
  ConsentRecord,
} from './types';

/** Sort key for the durable owner-profile record. */
export function ownerProfileSK(userId: string): string {
  return `PROFILE#${userSK(userId)}`;
}

/** Sort key for the durable marketing-consent record. */
export function consentSK(userId: string): string {
  return `CONSENT#${userSK(userId)}`;
}

/** Resolves the tenants table name from configuration. */
function resolveTableName(explicit?: string): string {
  const tableName = explicit ?? process.env['TENANTS_TABLE'];
  if (!tableName) {
    throw new Error(
      'RegistrationCompletionRepository requires a table name (TENANTS_TABLE).'
    );
  }
  return tableName;
}

export interface CompleteRegistrationResult {
  /**
   * true  -> this call committed the durable records.
   * false -> the records already existed (idempotent retry); nothing written.
   * Either way the registration is durably complete and the caller may emit
   * the event and clean up the pending record.
   */
  committed: boolean;
}

export class RegistrationCompletionRepository {
  private readonly docClient: DynamoDBDocumentClient;
  private readonly tableName: string;

  constructor(options?: {
    tableName?: string;
    docClient?: DynamoDBDocumentClient;
  }) {
    this.tableName = resolveTableName(options?.tableName);
    this.docClient =
      options?.docClient ??
      DynamoDBDocumentClient.from(
        new DynamoDBClient({ region: process.env['AWS_REGION'] ?? 'eu-west-1' }),
        { marshallOptions: { removeUndefinedValues: true } }
      );
  }

  /**
   * Atomically and idempotently commits the tenant, owner-profile and consent
   * records for a completed self-signup registration.
   *
   * Idempotency: each Put carries `attribute_not_exists(PK) AND
   * attribute_not_exists(SK)` so re-running with the same tenantId/userId never
   * duplicates a record. If the transaction is cancelled solely because the
   * records already exist (a retry after a prior successful commit), this
   * resolves with `{ committed: false }` instead of throwing — the records are
   * already durable. Any other failure (throttling, access denied, a genuine
   * mid-flight error) throws so the caller does NOT emit a success event and
   * does NOT delete the pending record, preserving state for safe retry.
   */
  async complete(
    input: CompleteRegistrationInput
  ): Promise<CompleteRegistrationResult> {
    const pk = tenantPK(input.tenantId);
    const nowIso = new Date().toISOString();

    const tenantRecord: TenantMetadataRecord = {
      PK: pk,
      SK: 'METADATA',
      tenantId: input.tenantId,
      organisationName: input.organisationName,
      status: 'active',
      ownerId: input.userId,
      createdAt: nowIso,
      registrationId: input.registrationId,
    };

    const profileRecord: OwnerProfileRecord = {
      PK: pk,
      SK: ownerProfileSK(input.userId),
      tenantId: input.tenantId,
      userId: input.userId,
      email: input.email,
      fullName: input.fullName,
      phoneNumber: input.phoneNumber,
      role: 'owner',
      createdAt: nowIso,
    };

    const consentRecord: ConsentRecord = {
      PK: pk,
      SK: consentSK(input.userId),
      tenantId: input.tenantId,
      userId: input.userId,
      type: 'marketing',
      granted: input.marketingConsent.granted,
      // Preserve the ORIGINAL capture timestamp from the registration form,
      // not the completion time — consent was recorded when the user submitted.
      capturedAt: input.marketingConsent.capturedAt,
    };

    // Create-only condition: the exact PK+SK must not already exist. Guarantees
    // no record is overwritten and makes the whole transaction a safe no-op on
    // a retry of an already-committed registration.
    const createOnly = 'attribute_not_exists(PK) AND attribute_not_exists(SK)';

    try {
      await this.docClient.send(
        new TransactWriteCommand({
          TransactItems: [
            {
              Put: {
                TableName: this.tableName,
                Item: tenantRecord,
                ConditionExpression: createOnly,
              },
            },
            {
              Put: {
                TableName: this.tableName,
                Item: profileRecord,
                ConditionExpression: createOnly,
              },
            },
            {
              Put: {
                TableName: this.tableName,
                Item: consentRecord,
                ConditionExpression: createOnly,
              },
            },
          ],
        })
      );
      return { committed: true };
    } catch (error) {
      // A TransactionCanceledException whose cancellation reasons are ALL
      // conditional-check failures means the records already exist — an
      // idempotent retry. Treat it as success (committed: false). Any other
      // cancellation reason (throttling, validation, etc.) or any other error
      // must propagate so the caller preserves pending state for retry.
      if (
        error instanceof TransactionCanceledException &&
        isPureConditionalFailure(error)
      ) {
        return { committed: false };
      }
      throw error;
    }
  }
}

/**
 * Returns true only when every cancellation reason on a cancelled transaction
 * is a conditional-check failure (i.e. the records already exist). A mix that
 * includes any other reason (ThrottlingError, TransactionConflict, etc.) is
 * NOT treated as idempotent success.
 */
function isPureConditionalFailure(
  error: TransactionCanceledException
): boolean {
  const reasons = error.CancellationReasons;
  if (!reasons || reasons.length === 0) return false;
  return reasons.every((r) => r.Code === 'ConditionalCheckFailed' || r.Code === 'None');
}
