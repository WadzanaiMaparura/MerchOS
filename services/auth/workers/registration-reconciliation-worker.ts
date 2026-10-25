/**
 * Registration reconciliation worker (Stage B).
 *
 * SQS-triggered Lambda that durably completes a registration whose
 * confirmation-time persistence did not succeed. For each message it:
 *
 *   1. Parses + validates the non-PII reconciliation message (schemaVersion,
 *      registrationId, cognitoUsername).
 *   2. Reads the pending-registration record by registrationId (primary-key
 *      GetItem; no scan, no index) and checks expiry + integrity.
 *   3. Fetches AUTHORITATIVE user attributes from Cognito (AdminGetUser):
 *      sub, email, email_verified, custom:tenantId, custom:role.
 *   4. Verifies the confirmed identity matches the pending registration
 *      (email match) and is eligible (verified, owner, has tenant).
 *   5. Persists through the APPROVED idempotent repository
 *      (completeOwnerProfile) — never a competing persistence path.
 *   6. Best-effort deletes the pending record.
 *
 * Retry / failure semantics:
 *   - Transient failures (throttling, 5xx, transaction conflict, Cognito
 *     throttling) throw so the SQS message is retried and, after the redrive
 *     maxReceiveCount, lands on the DLQ.
 *   - Terminal validation failures (bad payload, expired/missing pending,
 *     identity mismatch, ineligible account, durable-state conflict) are
 *     swallowed as "handled" so the message is NOT retried forever — they are
 *     recorded via metrics + structured logs and (for conflicts) are visible on
 *     dashboards/alarms. A terminal failure must not wedge the queue.
 *   - Uses partial batch response (reportBatchItemFailures) so one retryable
 *     message does not force reprocessing of siblings that already succeeded.
 *
 * PRIVACY: messages and logs carry only non-PII correlation ids
 * (registrationId, cognitoUsername, tenantId, metric dimensions). Email, names,
 * phone, organisation, consent copy and tokens are never logged.
 *
 * IDEMPOTENCY: duplicate deliveries cannot create duplicate tenants/owners/
 * consents because completeOwnerProfile conditions every write on
 * attribute_not_exists(SK) and reports already_completed on replay.
 */

import type { SQSEvent, SQSBatchResponse, SQSRecord } from 'aws-lambda';
import { AdminGetUserCommand } from '@aws-sdk/client-cognito-identity-provider';
import type { AdminGetUserCommandOutput } from '@aws-sdk/client-cognito-identity-provider';

import { logger, metrics, MetricUnit } from '../../shared/middleware/powertools';
import { getCognitoClient } from '../utils/cognito-client';
import {
  getPendingRegistration,
  isPendingRegistrationExpired,
  deletePendingRegistration,
} from '../repository/pending-registration-repository';
import {
  completeOwnerProfile,
  TransientPersistenceError,
} from '../repository/registration-persistence';
import { CONSENT_TEXT_VERSION } from '../config/consent';
import type {
  RegistrationReconciliationMessage,
  ConsentChannel,
  ConsentStatus,
} from '../../shared/types/registration.types';

/** Metric names (EMF, namespace MerchOS). */
const METRIC = {
  attempt: 'ReconciliationAttempt',
  success: 'ReconciliationSuccess',
  retryable: 'ReconciliationRetryableFailure',
  terminal: 'ReconciliationTerminalFailure',
  missingExpired: 'ReconciliationMissingOrExpiredPending',
  identityMismatch: 'ReconciliationIdentityMismatch',
  invalidMessage: 'ReconciliationInvalidMessage',
} as const;

/** Raised for terminal (non-retryable) outcomes. The message is acknowledged. */
class TerminalReconciliationError extends Error {
  constructor(message: string, public readonly reason: string) {
    super(message);
    this.name = 'TerminalReconciliationError';
  }
}

function addCount(name: string): void {
  metrics.addMetric(name, MetricUnit.Count, 1);
}

/** Validate the raw SQS body into a typed, non-PII reconciliation message. */
function parseMessage(body: string): RegistrationReconciliationMessage {
  let parsed: unknown;
  try {
    parsed = JSON.parse(body);
  } catch {
    throw new TerminalReconciliationError('message body is not valid JSON', 'invalid_json');
  }

  const m = parsed as Partial<RegistrationReconciliationMessage>;
  if (
    !m ||
    m.schemaVersion !== 1 ||
    typeof m.registrationId !== 'string' ||
    m.registrationId.length === 0 ||
    typeof m.cognitoUsername !== 'string' ||
    m.cognitoUsername.length === 0
  ) {
    throw new TerminalReconciliationError('message failed schema validation', 'invalid_schema');
  }

  return {
    schemaVersion: 1,
    registrationId: m.registrationId,
    cognitoUsername: m.cognitoUsername,
  };
}

/** Extract a single string attribute from an AdminGetUser response. */
function attr(out: AdminGetUserCommandOutput, name: string): string | undefined {
  return out.UserAttributes?.find((a) => a.Name === name)?.Value;
}

/** Transient (retryable) classification for Cognito/SDK errors. */
function isTransient(err: unknown): boolean {
  if (err instanceof TransientPersistenceError) return true;
  const name = (err as { name?: string })?.name;
  if (
    name === 'ThrottlingException' ||
    name === 'TooManyRequestsException' ||
    name === 'InternalErrorException' ||
    name === 'ServiceUnavailable' ||
    name === 'TimeoutError'
  ) {
    return true;
  }
  const status = (err as { $metadata?: { httpStatusCode?: number } })?.$metadata?.httpStatusCode;
  return typeof status === 'number' && status >= 500;
}

/**
 * Reconcile a single message. Throws on transient failure (→ SQS retry);
 * returns normally on success OR terminal handled failure (→ acknowledge).
 */
async function reconcileOne(record: SQSRecord): Promise<void> {
  addCount(METRIC.attempt);

  const tenantsTable = process.env['TENANTS_TABLE'];
  if (!tenantsTable) {
    // Misconfiguration is transient from the message's perspective — retry.
    throw new Error('TENANTS_TABLE environment variable is not set');
  }
  const userPoolId = process.env['COGNITO_USER_POOL_ID'];
  if (!userPoolId) {
    throw new Error('COGNITO_USER_POOL_ID environment variable is not set');
  }

  let message: RegistrationReconciliationMessage;
  try {
    message = parseMessage(record.body);
  } catch (err) {
    addCount(METRIC.invalidMessage);
    addCount(METRIC.terminal);
    logger.error('reconciliation: invalid message, acknowledging', {
      messageId: record.messageId,
      reason: err instanceof TerminalReconciliationError ? err.reason : 'unknown',
    });
    return; // terminal — do not retry a malformed message
  }

  const correlation = {
    registrationId: message.registrationId,
    cognitoUsername: message.cognitoUsername,
    messageId: record.messageId,
  };

  try {
    // 1) Load pending record (primary-key read, strongly consistent).
    const pending = await getPendingRegistration(tenantsTable, message.registrationId);
    if (!pending) {
      addCount(METRIC.missingExpired);
      addCount(METRIC.terminal);
      logger.warn('reconciliation: pending record missing, acknowledging', correlation);
      return;
    }
    if (isPendingRegistrationExpired(pending)) {
      addCount(METRIC.missingExpired);
      addCount(METRIC.terminal);
      logger.warn('reconciliation: pending record expired, acknowledging', correlation);
      // Best-effort cleanup of the expired record.
      await safeDelete(tenantsTable, message.registrationId, correlation);
      return;
    }

    // 2) Authoritative identity from Cognito (never trust the queue for identity).
    const cognito = getCognitoClient();
    const user = await cognito.send(
      new AdminGetUserCommand({ UserPoolId: userPoolId, Username: message.cognitoUsername }),
    );

    const sub = attr(user, 'sub');
    const email = attr(user, 'email');
    const emailVerified = attr(user, 'email_verified') === 'true';
    const tenantId = attr(user, 'custom:tenantId');
    const role = attr(user, 'custom:role');

    // 3) Eligibility + identity-match checks (all terminal — they will not
    //    change on retry for the same confirmed account).
    if (!sub || !email || !tenantId) {
      addCount(METRIC.terminal);
      logger.warn('reconciliation: cognito user missing required attributes, acknowledging', {
        ...correlation,
        hasSub: !!sub,
        hasEmail: !!email,
        hasTenant: !!tenantId,
      });
      return;
    }
    if (!emailVerified) {
      addCount(METRIC.terminal);
      logger.warn('reconciliation: cognito email not verified, acknowledging', correlation);
      return;
    }
    if (role !== 'owner') {
      addCount(METRIC.terminal);
      logger.warn('reconciliation: non-owner account, acknowledging', { ...correlation, role });
      return;
    }
    // The confirmed identity MUST match the pending registration it claims to
    // complete. Compare case-insensitively on the normalised email.
    if (email.trim().toLowerCase() !== pending.email.trim().toLowerCase()) {
      addCount(METRIC.identityMismatch);
      addCount(METRIC.terminal);
      logger.error('reconciliation: identity mismatch vs pending record, acknowledging', correlation);
      return;
    }

    // 4) Persist via the APPROVED idempotent repository. Business details come
    //    from the pending record; identity/tenant/role come from Cognito.
    const consentStatus: ConsentStatus = pending.consentStatus;
    const consentChannels: ConsentChannel[] =
      consentStatus === 'granted' ? pending.consentChannels ?? [] : [];

    const outcome = await completeOwnerProfile(tenantsTable, {
      tenantId,
      userId: sub,
      email,
      role,
      fullName: pending.fullName,
      phone: pending.phone,
      organisationName: pending.organisationName,
      registrationId: message.registrationId,
      consentStatus,
      consentChannels,
      consentTextVersion: pending.consentTextVersion ?? CONSENT_TEXT_VERSION,
    });

    if (outcome.result === 'conflict') {
      // Durable state is owned by someone else / inconsistent — never overwrite.
      // Terminal: acknowledge and surface via logs/metrics for investigation.
      addCount(METRIC.terminal);
      logger.error('reconciliation: durable-state conflict, acknowledging', {
        ...correlation,
        reason: outcome.reason,
      });
      await safeDelete(tenantsTable, message.registrationId, correlation);
      return;
    }

    // created or already_completed → success (idempotent).
    addCount(METRIC.success);
    logger.info('reconciliation: completed', { ...correlation, outcome: outcome.result });

    // 5) Best-effort cleanup. Failure here is non-fatal (TTL is the backstop).
    await safeDelete(tenantsTable, message.registrationId, correlation);
  } catch (err) {
    if (isTransient(err)) {
      addCount(METRIC.retryable);
      logger.warn('reconciliation: transient failure, will retry', {
        ...correlation,
        error: err instanceof Error ? err.name : 'unknown',
      });
      throw err; // retry via SQS; DLQ after maxReceiveCount
    }
    // Unknown non-transient error — treat as terminal to avoid poison-message
    // loops, but record loudly.
    addCount(METRIC.terminal);
    logger.error('reconciliation: terminal failure, acknowledging', {
      ...correlation,
      error: err instanceof Error ? err.message : String(err),
    });
  }
}

/** Delete the pending record, swallowing non-fatal cleanup errors. */
async function safeDelete(
  tableName: string,
  registrationId: string,
  correlation: Record<string, unknown>,
): Promise<void> {
  try {
    await deletePendingRegistration(tableName, registrationId);
  } catch (err) {
    logger.warn('reconciliation: pending cleanup failed (non-fatal)', {
      ...correlation,
      error: err instanceof Error ? err.name : 'unknown',
    });
  }
}

/**
 * SQS batch handler with partial-batch-failure reporting.
 *
 * Only messages that threw (transient) are reported as failures so they are
 * retried individually; successfully handled and terminally-handled messages
 * are acknowledged.
 */
export async function handler(event: SQSEvent): Promise<SQSBatchResponse> {
  const batchItemFailures: { itemIdentifier: string }[] = [];

  for (const record of event.Records) {
    try {
      await reconcileOne(record);
    } catch {
      // reconcileOne only throws for transient/retryable failures.
      batchItemFailures.push({ itemIdentifier: record.messageId });
    }
  }

  metrics.publishStoredMetrics();
  return { batchItemFailures };
}
