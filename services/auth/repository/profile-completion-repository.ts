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
  /**
   * A prior call already committed records that are complete AND whose saved
   * data matches the submitted registration for this subject (idempotent
   * same-data replay). Verified field-by-field, not just by IDs/presence.
   */
  | { result: 'already_completed' }
  /**
   * Durable state conflicts with this subject: tenant/owner owned by someone
   * else, inconsistent/partial state, OR an existing record whose saved data
   * differs from the submitted registration. The caller must fail safe and
   * NEVER overwrite.
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
      return classifyExistingState(state, params);
    }

    // Unknown / programming error — surface it (non-retryable).
    throw err;
  }
}

/**
 * Decide the retry outcome from the durable state read back after a conditional
 * cancellation.
 *
 * `already_completed` is returned ONLY when all three records exist AND every
 * persisted field matches the submitted registration data for THIS subject.
 * Verifying IDs + presence alone is insufficient: a record could reference the
 * right user yet hold different organisation/name/phone/consent values — which
 * must fail closed rather than be reported as a successful idempotent retry (and
 * must never be overwritten).
 *
 * This recovery handler mints a fresh registrationId and timestamp on every
 * request, so those volatile values are NOT compared against the submitted
 * ones: registrationId/createdAt/capturedAt are validated for presence/validity
 * only, never for equality with this attempt's regenerated values.
 */
function classifyExistingState(
  state: DurableState,
  params: CompleteOwnerProfileParams,
): CompleteOwnerProfileOutcome {
  const { metadata, owner, consent } = state;

  const metadataOwnedByUs =
    metadata?.ownerId === params.userId && metadata?.tenantId === params.tenantId;
  const ownerIsUs =
    owner?.userId === params.userId && owner?.tenantId === params.tenantId;

  // Tenant/owner belongs to a DIFFERENT subject — never overwrite.
  if ((owner && !ownerIsUs) || (metadata && !metadataOwnedByUs)) {
    return {
      result: 'conflict',
      reason: 'tenant or owner profile belongs to a different subject',
    };
  }

  // Any record missing → partial/inconsistent state, fail safe.
  if (!metadata || !owner || !consent) {
    return {
      result: 'conflict',
      reason: 'incomplete or inconsistent durable state; manual reconciliation required',
    };
  }

  // All three exist for THIS subject. Now require the SAVED data to match the
  // submitted registration data. A mismatch is a genuine data conflict (the
  // caller submitted different details than what is already stored) — fail
  // closed; never silently report success and never overwrite.
  const expectedChannels = params.consentGranted ? params.consentChannels : [];
  const mismatches: string[] = [];

  // Tenant metadata.
  if (metadata.organisationName !== params.organisationName) mismatches.push('tenant.organisationName');
  if (metadata.status !== 'active') mismatches.push('tenant.status');

  // Owner profile.
  if (owner.email !== params.email) mismatches.push('owner.email');
  if (owner.fullName !== params.fullName) mismatches.push('owner.fullName');
  if (owner.phoneNumber !== params.phone) mismatches.push('owner.phoneNumber');
  if (owner.role !== 'owner') mismatches.push('owner.role');

  // Consent: identity + type + granted state + audit metadata.
  if (consent.type !== 'marketing') mismatches.push('consent.type');
  if (consent.granted !== params.consentGranted) mismatches.push('consent.granted');
  if (consent.consentTextVersion !== params.consentTextVersion) mismatches.push('consent.consentTextVersion');
  if (!channelsEqual(consent.channels ?? [], expectedChannels)) mismatches.push('consent.channels');
  // capturedAt is a per-request timestamp (regenerated on each retry), so it is
  // validated for PRESENCE/validity only — never compared for equality.
  if (!isNonEmptyString(consent.capturedAt)) mismatches.push('consent.capturedAt');

  if (mismatches.length > 0) {
    return {
      result: 'conflict',
      reason: `existing profile data does not match submitted registration (${mismatches.join(', ')})`,
    };
  }

  // Fully consistent, same-data retry.
  return { result: 'already_completed' };
}

/** True when two consent-channel lists contain the same set of channels. */
function channelsEqual(a: readonly string[], b: readonly string[]): boolean {
  if (a.length !== b.length) return false;
  const sa = [...a].sort();
  const sb = [...b].sort();
  return sa.every((v, i) => v === sb[i]);
}

function isNonEmptyString(v: unknown): boolean {
  return typeof v === 'string' && v.trim().length > 0;
}
