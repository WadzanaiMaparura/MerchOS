/**
 * Registration-persistence repository (Stage 1 — profile-completion recovery).
 *
 * Narrowly scoped repository that atomically creates a tenant's metadata, owner
 * profile, and consent records using an explicit-condition TransactWriteItems.
 *
 * IMPORTANT: This intentionally does NOT use TenantDynamoClient. That wrapper
 * injects `PK = :callerTenantPK` conditions on every item, which is correct for
 * tenant-scoped writes but is incompatible with the cross-partition
 * PENDINGREG# delete planned for a later stage, and would also obscure the
 * explicit conditional-create semantics this flow needs. TenantDynamoClient's
 * behaviour is left entirely unchanged; this repository uses the raw
 * DynamoDBDocumentClient with hand-written conditions.
 *
 * Stage 1 scope: it does NOT create or delete any PENDINGREG# record.
 */

import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import {
  DynamoDBDocumentClient,
  GetCommand,
  TransactWriteCommand,
} from '@aws-sdk/lib-dynamodb';
import { TransactionCanceledException } from '@aws-sdk/client-dynamodb';

import { tenantPK, userSK } from '../../shared/utils/dynamo-client';
import type {
  TenantMetadataRecord,
  OwnerProfileRecord,
  ConsentRecord,
  ConsentChannel,
  ConsentStatus,
} from '../../shared/types/registration.types';

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
export function resetRegistrationRepositoryClient(): void {
  docClient = null;
}

// ---------------------------------------------------------------------------
// Keys
// ---------------------------------------------------------------------------

/** Stable consent SK keyed on registrationId so replays can't duplicate it. */
export function consentSK(userId: string, registrationId: string): string {
  return `${userSK(userId)}#CONSENT#${registrationId}`;
}

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface CompleteOwnerProfileParams {
  tenantId: string;
  /** Cognito sub. */
  userId: string;
  /** Verified email from trusted JWT claims. */
  email: string;
  role: string;
  fullName: string;
  phone: string;
  organisationName: string;
  /** Server-controlled correlation/idempotency id. */
  registrationId: string;
  consentStatus: ConsentStatus;
  consentChannels: ConsentChannel[];
  consentTextVersion: string;
}

export type CompleteOwnerProfileOutcome =
  /** The transaction committed on this call. */
  | { result: 'created' }
  /** A prior call already committed the identical records (idempotent replay). */
  | { result: 'already_completed' }
  /**
   * Durable state conflicts with this subject (tenant/owner owned by someone
   * else, or inconsistent partial state). The caller must fail safe and NOT
   * overwrite.
   */
  | { result: 'conflict'; reason: string };

/** Raised for transient/retryable failures (throttling, transaction conflict,
 *  5xx). The caller may retry with bounded backoff. */
export class TransientPersistenceError extends Error {
  constructor(message: string, public readonly cause?: unknown) {
    super(message);
    this.name = 'TransientPersistenceError';
  }
}

// ---------------------------------------------------------------------------
// Transient-error classification
// ---------------------------------------------------------------------------

const TRANSIENT_CANCELLATION_CODES = new Set([
  'TransactionConflict',
  'ThrottlingError',
  'ProvisionedThroughputExceeded',
]);

const TRANSIENT_ERROR_NAMES = new Set([
  'ThrottlingException',
  'ProvisionedThroughputExceededException',
  'RequestLimitExceeded',
  'InternalServerError',
  'ServiceUnavailable',
  'TimeoutError',
]);

/**
 * Returns true when a TransactionCanceledException was cancelled purely for
 * transient reasons (no ConditionalCheckFailed). Conditional failures are
 * deterministic and must be resolved by verification reads, never retried.
 */
function isTransientCancellation(err: TransactionCanceledException): boolean {
  const reasons = err.CancellationReasons ?? [];
  const hasConditionalFailure = reasons.some((r) => r.Code === 'ConditionalCheckFailed');
  if (hasConditionalFailure) return false;
  return reasons.some((r) => r.Code && TRANSIENT_CANCELLATION_CODES.has(r.Code));
}

function isTransientError(err: unknown): boolean {
  if (err instanceof TransactionCanceledException) return isTransientCancellation(err);
  const name = (err as { name?: string })?.name;
  if (name && TRANSIENT_ERROR_NAMES.has(name)) return true;
  const statusCode = (err as { $metadata?: { httpStatusCode?: number } })?.$metadata
    ?.httpStatusCode;
  return typeof statusCode === 'number' && statusCode >= 500;
}

// ---------------------------------------------------------------------------
// Verification read (source of truth after a conditional cancellation)
// ---------------------------------------------------------------------------

interface DurableState {
  metadata: TenantMetadataRecord | undefined;
  owner: OwnerProfileRecord | undefined;
  consent: ConsentRecord | undefined;
}

async function readDurableState(
  tableName: string,
  params: CompleteOwnerProfileParams,
): Promise<DurableState> {
  const pk = tenantPK(params.tenantId);
  const client = getDocClient();

  const [meta, owner, consent] = await Promise.all([
    client.send(new GetCommand({ TableName: tableName, Key: { PK: pk, SK: 'METADATA' } })),
    client.send(
      new GetCommand({ TableName: tableName, Key: { PK: pk, SK: userSK(params.userId) } }),
    ),
    client.send(
      new GetCommand({
        TableName: tableName,
        Key: { PK: pk, SK: consentSK(params.userId, params.registrationId) },
      }),
    ),
  ]);

  return {
    metadata: meta.Item as TenantMetadataRecord | undefined,
    owner: owner.Item as OwnerProfileRecord | undefined,
    consent: consent.Item as ConsentRecord | undefined,
  };
}

// ---------------------------------------------------------------------------
// Main operation
// ---------------------------------------------------------------------------

/**
 * Atomically create tenant metadata, owner profile, and consent records for a
 * genuine self-registration owner.
 *
 * Idempotency & conflict handling:
 *  - Each Put uses `attribute_not_exists(SK)` so an existing tenant/owner/consent
 *    cannot be overwritten.
 *  - On TransactionCanceledException: transient cancellations throw
 *    TransientPersistenceError (caller may retry); conditional cancellations
 *    trigger a verification read of the durable state to decide:
 *      * all three records exist AND the owner belongs to THIS subject AND the
 *        consent row for THIS registrationId exists  -> 'already_completed'
 *      * owner exists under a DIFFERENT subject, or tenant metadata records a
 *        different ownerUserId/tenantId               -> 'conflict'
 *      * partial/inconsistent state                   -> 'conflict'
 *  - Never returns success from a bare condition failure without verifying the
 *    full durable state.
 */
export async function completeOwnerProfile(
  tableName: string,
  params: CompleteOwnerProfileParams,
): Promise<CompleteOwnerProfileOutcome> {
  const pk = tenantPK(params.tenantId);
  const now = new Date().toISOString();

  const metadata: TenantMetadataRecord = {
    PK: pk,
    SK: 'METADATA',
    tenantId: params.tenantId,
    organisationName: params.organisationName,
    ownerUserId: params.userId,
    registrationId: params.registrationId,
    status: 'active',
    createdAt: now,
  };

  const owner: OwnerProfileRecord = {
    PK: pk,
    SK: userSK(params.userId),
    tenantId: params.tenantId,
    userId: params.userId,
    email: params.email,
    fullName: params.fullName,
    phone: params.phone,
    role: params.role,
    createdAt: now,
  };

  const consent: ConsentRecord = {
    PK: pk,
    SK: consentSK(params.userId, params.registrationId),
    tenantId: params.tenantId,
    userId: params.userId,
    status: params.consentStatus,
    consentTextVersion: params.consentTextVersion,
    channels: params.consentStatus === 'granted' ? params.consentChannels : [],
    source: 'profile-completion',
    registrationId: params.registrationId,
    grantedAt: now,
  };

  const client = getDocClient();

  try {
    await client.send(
      new TransactWriteCommand({
        TransactItems: [
          {
            Put: {
              TableName: tableName,
              Item: metadata,
              ConditionExpression: 'attribute_not_exists(SK)',
            },
          },
          {
            Put: {
              TableName: tableName,
              Item: owner,
              ConditionExpression: 'attribute_not_exists(SK)',
            },
          },
          {
            Put: {
              TableName: tableName,
              Item: consent,
              ConditionExpression: 'attribute_not_exists(SK)',
            },
          },
        ],
      }),
    );

    return { result: 'created' };
  } catch (err) {
    // Transient failures are retryable by the caller.
    if (isTransientError(err)) {
      throw new TransientPersistenceError(
        'Transient DynamoDB failure during profile completion',
        err,
      );
    }

    // A conditional cancellation means something already exists. Verify the
    // durable state before deciding success vs conflict.
    if (err instanceof TransactionCanceledException) {
      const state = await readDurableState(tableName, params);

      const metadataOwnedByUs =
        state.metadata?.ownerUserId === params.userId &&
        state.metadata?.tenantId === params.tenantId;
      const ownerIsUs =
        state.owner?.userId === params.userId && state.owner?.tenantId === params.tenantId;

      // Fully and consistently completed by a prior invocation for THIS subject.
      if (state.metadata && state.owner && state.consent && metadataOwnedByUs && ownerIsUs) {
        return { result: 'already_completed' };
      }

      // Tenant/owner belongs to a different subject — never overwrite.
      if ((state.owner && !ownerIsUs) || (state.metadata && !metadataOwnedByUs)) {
        return {
          result: 'conflict',
          reason: 'tenant or owner profile belongs to a different subject',
        };
      }

      // Partial / inconsistent durable state — fail safe, do not fabricate.
      return {
        result: 'conflict',
        reason: 'incomplete or inconsistent durable state; manual reconciliation required',
      };
    }

    // Unknown / programming error — surface it (non-retryable).
    throw err;
  }
}
