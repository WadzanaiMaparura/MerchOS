/**
 * Profile-completion persistence (recovery path for POST /auth/complete-profile).
 *
 * Atomically creates the CANONICAL tenant metadata, owner profile and consent
 * records for a genuine self-registration owner whose durable records are
 * missing. It deliberately reuses the SAME canonical keys, record types and
 * create-only TransactWriteItems pattern as the PostConfirmation self-signup
 * path (RegistrationCompletionRepository), so there is exactly ONE owner/consent
 * record format in the tenants table:
 *   SK = `METADATA`             (field ownerId)
 *   SK = `PROFILE#USER#<userId>`
 *   SK = `CONSENT#USER#<userId>`
 *
 * This path differs from the self-signup path only in its RETURN CONTRACT: it
 * reports created / already_completed / conflict so the authenticated recovery
 * handler can respond appropriately, and it preserves the richer consent audit
 * metadata (channels, consentTextVersion, source) on the shared ConsentRecord.
 *
 * Idempotency & safety:
 *  - Each Put uses `attribute_not_exists(SK)` so an existing tenant/owner/consent
 *    is never overwritten (tenant isolation / no identity clobbering).
 *  - A transient cancellation throws TransientPersistenceError (caller retries).
 *  - A conditional cancellation triggers a STRONGLY CONSISTENT verification read
 *    of the durable state to decide already_completed vs conflict — it never
 *    infers success from reason codes alone.
 *
 * Raw DynamoDBDocumentClient (not TenantDynamoClient): the tenantId is taken
 * from trusted JWT claims and the explicit conditional-create semantics are
 * clearer hand-written.
 */

import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import {
  DynamoDBDocumentClient,
  GetCommand,
  TransactWriteCommand,
} from '@aws-sdk/lib-dynamodb';
import { TransactionCanceledException } from '@aws-sdk/client-dynamodb';

import { tenantPK } from '../../shared/utils/dynamo-client';
import {
  ownerProfileSK,
  consentSK,
} from '../registration/registration-completion-repository';
import type {
  TenantMetadataRecord,
  OwnerProfileRecord,
  ConsentRecord,
  ConsentChannel,
} from '../registration/types';

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
export function resetProfileCompletionRepositoryClient(): void {
  docClient = null;
}

/** Allow tests to inject a mocked doc client. */
export function __setProfileCompletionDocClientForTesting(
  client: DynamoDBDocumentClient | null,
): void {
  docClient = client;
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
  /** Whether the user opted in to marketing. */
  consentGranted: boolean;
  /** Channels explicitly selected (only when granted). */
  consentChannels: ConsentChannel[];
  /** Version identifier of the consent copy the user saw. */
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
 * True when a TransactionCanceledException was cancelled purely for transient
 * reasons (no ConditionalCheckFailed). Conditional failures are deterministic
 * and must be resolved by verification reads, never retried.
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
// Verification read (strongly consistent — source of truth after cancellation)
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
    client.send(
      new GetCommand({ TableName: tableName, Key: { PK: pk, SK: 'METADATA' }, ConsistentRead: true }),
    ),
    client.send(
      new GetCommand({
        TableName: tableName,
        Key: { PK: pk, SK: ownerProfileSK(params.userId) },
        ConsistentRead: true,
      }),
    ),
    client.send(
      new GetCommand({
        TableName: tableName,
        Key: { PK: pk, SK: consentSK(params.userId) },
        ConsistentRead: true,
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
 * Atomically create the canonical tenant metadata, owner profile and consent
 * records for a genuine self-registration owner (recovery path).
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
    ownerId: params.userId,
    registrationId: params.registrationId,
    status: 'active',
    createdAt: now,
  };

  const owner: OwnerProfileRecord = {
    PK: pk,
    SK: ownerProfileSK(params.userId),
    tenantId: params.tenantId,
    userId: params.userId,
    email: params.email,
    fullName: params.fullName,
    phoneNumber: params.phone,
    role: 'owner',
    createdAt: now,
  };

  const consent: ConsentRecord = {
    PK: pk,
    SK: consentSK(params.userId),
    tenantId: params.tenantId,
    userId: params.userId,
    type: 'marketing',
    granted: params.consentGranted,
    capturedAt: now,
    // Richer audit metadata preserved from the recovery flow.
    channels: params.consentGranted ? params.consentChannels : [],
    consentTextVersion: params.consentTextVersion,
    source: 'profile-completion',
  };

  const client = getDocClient();
  const createOnly = 'attribute_not_exists(SK)';

  try {
    await client.send(
      new TransactWriteCommand({
        TransactItems: [
          { Put: { TableName: tableName, Item: metadata, ConditionExpression: createOnly } },
          { Put: { TableName: tableName, Item: owner, ConditionExpression: createOnly } },
          { Put: { TableName: tableName, Item: consent, ConditionExpression: createOnly } },
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
    // durable state (strongly consistent) before deciding success vs conflict.
    if (err instanceof TransactionCanceledException) {
      const state = await readDurableState(tableName, params);

      const metadataOwnedByUs =
        state.metadata?.ownerId === params.userId &&
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
