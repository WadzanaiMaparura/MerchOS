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
 *     half-writes them. When the transaction is cancelled (records already
 *     exist), the repository READS BACK all three records and verifies they
 *     form a complete, matching registration before reporting a no-op retry —
 *     it never infers success from the cancellation reason codes alone.
 *   - FAIL-CLOSED ON INCONSISTENCY: if a cancelled transaction's existing
 *     records are incomplete (a record is missing) or conflict (an existing
 *     record belongs to a different registration/user), it throws a
 *     RegistrationConsistencyError so the caller does NOT emit the event or
 *     delete the pending record.
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
  GetCommand,
} from '@aws-sdk/lib-dynamodb';
import { TransactionCanceledException } from '@aws-sdk/client-dynamodb';

import { tenantPK, userSK } from '../../shared/utils/dynamo-client';
import type {
  CompleteRegistrationInput,
  TenantMetadataRecord,
  OwnerProfileRecord,
  ConsentRecord,
} from './types';

/**
 * Raised when a create-only completion transaction is cancelled but the
 * existing records do NOT form a complete, matching registration (a record is
 * missing, or an existing record belongs to a different registration/user).
 * This is a fail-closed signal: the caller must NOT emit auth.user.registered
 * and must NOT delete the pending record.
 */
export class RegistrationConsistencyError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'RegistrationConsistencyError';
  }
}

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
   * false -> the records already existed AND were VERIFIED as the matching,
   *          complete registration (idempotent retry); nothing written.
   * Either way the registration is durably complete and the caller may emit
   * the event and clean up the pending record. A cancelled transaction whose
   * records are missing or conflicting throws instead (see
   * RegistrationConsistencyError).
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
   * duplicates a record. If the transaction is cancelled because records
   * already exist, the repository READS BACK all three records and verifies
   * they form the matching, complete registration before returning
   * `{ committed: false }`. It never trusts the cancellation reason codes
   * alone: partial state (some records exist, others don't) or a conflicting
   * owner would otherwise be misreported as a successful retry.
   *
   * Failure handling:
   *   - A non-"records exist" cancellation (throttling, validation, etc.) or
   *     any other error propagates unchanged.
   *   - A "records exist" cancellation with missing or conflicting records
   *     throws RegistrationConsistencyError.
   * In every failure case the caller must NOT emit auth.user.registered and
   * must NOT delete the pending record, preserving state for safe retry.
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
      // Optional audit metadata — persisted when the caller supplies it (the
      // complete-profile recovery path). The self-signup path omits these and
      // they are simply absent (removeUndefinedValues strips undefined). Only
      // channels explicitly selected under an opt-in are stored.
      channels: input.marketingConsent.granted
        ? input.marketingConsent.channels
        : [],
      consentTextVersion: input.marketingConsent.consentTextVersion,
      source: input.marketingConsent.source,
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
      // Only a "records already exist" cancellation is a candidate for an
      // idempotent retry. Any other cancellation reason (throttling,
      // validation, transaction conflict, etc.) or any non-transaction error
      // propagates unchanged so the caller preserves pending state.
      if (
        error instanceof TransactionCanceledException &&
        hasConditionalFailure(error)
      ) {
        // Do NOT trust the reason codes as proof of completion. Read the three
        // records back and verify they form the matching, complete
        // registration. Throws RegistrationConsistencyError if not.
        await this.verifyExistingRegistration(input);
        return { committed: false };
      }
      throw error;
    }
  }

  /**
   * Reads back the tenant metadata, owner profile and consent records and
   * verifies ALL THREE exist AND carry the EXACT expected registration data:
   *   - tenant metadata: tenantId, registrationId, ownerId, organisationName,
   *     status === 'active'
   *   - owner profile:   tenantId, userId, email, fullName, phoneNumber,
   *     role === 'owner'
   *   - marketing consent: tenantId, userId, type === 'marketing', granted,
   *     capturedAt
   * Throws RegistrationConsistencyError on any missing, conflicting OR
   * mismatched field. Verifying ownership alone is not enough — a record could
   * reference the correct user yet hold stale/incorrect data; deleting the
   * pending record in that case would lose the authoritative values.
   *
   * This is the authoritative idempotency check: it proves the prior commit
   * actually landed all three records, in full, for THIS registration, rather
   * than inferring it from a transaction cancellation reason.
   *
   * All three reads use ConsistentRead: true. We are deciding whether a prior
   * ATOMIC transaction committed; an eventually consistent read could return a
   * stale "missing" (or a partially replicated) view and cause us to either
   * falsely report inconsistency or, worse, miss a record that is actually
   * present. A strongly consistent read reflects the true committed state.
   */
  private async verifyExistingRegistration(
    input: CompleteRegistrationInput
  ): Promise<void> {
    const pk = tenantPK(input.tenantId);

    const [tenantRes, profileRes, consentRes] = await Promise.all([
      this.docClient.send(
        new GetCommand({
          TableName: this.tableName,
          Key: { PK: pk, SK: 'METADATA' },
          ConsistentRead: true,
        })
      ),
      this.docClient.send(
        new GetCommand({
          TableName: this.tableName,
          Key: { PK: pk, SK: ownerProfileSK(input.userId) },
          ConsistentRead: true,
        })
      ),
      this.docClient.send(
        new GetCommand({
          TableName: this.tableName,
          Key: { PK: pk, SK: consentSK(input.userId) },
          ConsistentRead: true,
        })
      ),
    ]);

    const tenant = tenantRes.Item as TenantMetadataRecord | undefined;
    const profile = profileRes.Item as OwnerProfileRecord | undefined;
    const consent = consentRes.Item as ConsentRecord | undefined;

    // All three must exist — a cancellation with any record missing is partial
    // state, NOT a completed registration.
    if (!tenant) {
      throw new RegistrationConsistencyError(
        `Completion cancelled but tenant metadata is missing for registration ${input.registrationId}`
      );
    }
    if (!profile) {
      throw new RegistrationConsistencyError(
        `Completion cancelled but owner profile is missing for registration ${input.registrationId}`
      );
    }
    if (!consent) {
      throw new RegistrationConsistencyError(
        `Completion cancelled but consent record is missing for registration ${input.registrationId}`
      );
    }

    // Every existing record must not only belong to THIS registration/owner but
    // also carry the EXACT registration data we would have written. Matching
    // identifiers alone is insufficient: a record could reference the right
    // user yet hold stale or incorrect profile/consent fields. If any field is
    // missing or mismatched we fail closed — the pending record is retained and
    // no success event is emitted — so the authoritative data is never lost or
    // silently superseded by a divergent copy.

    // Tenant metadata: identifiers + ownership + organisation name + status.
    if (tenant.tenantId !== input.tenantId || tenant.registrationId !== input.registrationId) {
      throw new RegistrationConsistencyError(
        `Existing tenant metadata does not match registration ${input.registrationId}`
      );
    }
    if (tenant.ownerId !== input.userId) {
      throw new RegistrationConsistencyError(
        `Existing tenant metadata owner does not match user for registration ${input.registrationId}`
      );
    }
    if (tenant.organisationName !== input.organisationName) {
      throw new RegistrationConsistencyError(
        `Existing tenant metadata organisationName does not match registration ${input.registrationId}`
      );
    }
    if (tenant.status !== 'active') {
      throw new RegistrationConsistencyError(
        `Existing tenant metadata status is not active for registration ${input.registrationId}`
      );
    }

    // Owner profile: identifiers + verified email + full name + phone + role.
    if (profile.tenantId !== input.tenantId || profile.userId !== input.userId) {
      throw new RegistrationConsistencyError(
        `Existing owner profile does not match registration ${input.registrationId}`
      );
    }
    if (profile.email !== input.email) {
      throw new RegistrationConsistencyError(
        `Existing owner profile email does not match registration ${input.registrationId}`
      );
    }
    if (profile.fullName !== input.fullName) {
      throw new RegistrationConsistencyError(
        `Existing owner profile fullName does not match registration ${input.registrationId}`
      );
    }
    if (profile.phoneNumber !== input.phoneNumber) {
      throw new RegistrationConsistencyError(
        `Existing owner profile phoneNumber does not match registration ${input.registrationId}`
      );
    }
    if (profile.role !== 'owner') {
      throw new RegistrationConsistencyError(
        `Existing owner profile role is not owner for registration ${input.registrationId}`
      );
    }

    // Marketing consent: identifiers + type + granted state + capture time.
    if (consent.tenantId !== input.tenantId || consent.userId !== input.userId) {
      throw new RegistrationConsistencyError(
        `Existing consent record does not match registration ${input.registrationId}`
      );
    }
    if (consent.type !== 'marketing') {
      throw new RegistrationConsistencyError(
        `Existing consent record type is not marketing for registration ${input.registrationId}`
      );
    }
    if (consent.granted !== input.marketingConsent.granted) {
      throw new RegistrationConsistencyError(
        `Existing consent record granted state does not match registration ${input.registrationId}`
      );
    }
    if (consent.capturedAt !== input.marketingConsent.capturedAt) {
      throw new RegistrationConsistencyError(
        `Existing consent record capturedAt does not match registration ${input.registrationId}`
      );
    }
  }
}

/**
 * Returns true when a cancelled transaction has at least one
 * ConditionalCheckFailed reason — i.e. the cancellation was (at least partly)
 * caused by a create-only condition tripping because a record already exists.
 * This only gates WHETHER we read back to verify; the read-back is what
 * actually decides idempotency vs inconsistency.
 */
function hasConditionalFailure(error: TransactionCanceledException): boolean {
  const reasons = error.CancellationReasons;
  if (!reasons || reasons.length === 0) return false;
  return reasons.some((r) => r.Code === 'ConditionalCheckFailed');
}
