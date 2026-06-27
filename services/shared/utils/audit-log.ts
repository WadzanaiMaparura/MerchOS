/**
 * Audit log writer for the MerchOS platform.
 *
 * Writes immutable audit log entries to DynamoDB for every state-changing
 * operation. Records actor, timestamp, action, affected resource, and
 * optional previous/new state for lifecycle transitions.
 *
 * Requirements: 1.10, 19.2
 */

import { randomUUID } from 'node:crypto';
import { TenantDynamoClient, AUDIT_LOG_TABLE, tenantPK, auditSK } from './dynamo-client';
import { logger } from '../middleware/powertools';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/** Categories of audit log actions. */
export type AuditAction =
  | 'tenant.created'
  | 'tenant.suspended'
  | 'tenant.reactivated'
  | 'tenant.deleted'
  | 'tenant.purge_complete'
  | 'product.lifecycle_transition'
  | 'product.attribute_approved'
  | 'product.attribute_overridden'
  | 'product.category_confirmed'
  | 'product.exported'
  | 'compliance.evaluated'
  | 'inventory.updated'
  | 'billing.plan_changed'
  | 'billing.credit_applied'
  | 'user.role_changed'
  | 'auth.login'
  | 'auth.logout'
  | 'auth.failed_login'
  | 'auth.mfa_verified'
  | 'auth.token_refresh'
  | 'auth.account_locked';

/**
 * A single audit log entry.
 * DynamoDB: PK TENANT#<tenantId>, SK AUDIT#<timestamp>#<eventId>
 */
export interface AuditLogEntry {
  /** UUID v4 */
  eventId: string;
  tenantId: string;
  /** ISO 8601 timestamp */
  timestamp: string;
  /** The actor who performed the action (user ID, 'system', or service name) */
  actor: string;
  action: AuditAction;
  /** Identifier of the affected resource (e.g. productId, userId) */
  resourceId: string;
  /** Type of the affected resource */
  resourceType: string;
  /** Previous value or state before the action */
  previousState?: string;
  /** New value or state after the action */
  newState?: string;
  /** Additional context-specific metadata */
  metadata?: Record<string, string | number | boolean>;
}

/** Input for creating a new audit log entry. */
export interface WriteAuditLogInput {
  tenantId: string;
  actor: string;
  action: AuditAction;
  resourceId: string;
  resourceType: string;
  previousState?: string;
  newState?: string;
  metadata?: Record<string, string | number | boolean>;
}

// ---------------------------------------------------------------------------
// Writer
// ---------------------------------------------------------------------------

/**
 * Write an immutable audit log entry to DynamoDB.
 *
 * @param client - A tenant-scoped DynamoDB client
 * @param input - The audit log entry fields
 * @returns The complete AuditLogEntry that was written
 */
export async function writeAuditLog(
  client: TenantDynamoClient,
  input: WriteAuditLogInput
): Promise<AuditLogEntry> {
  const eventId = randomUUID();
  const timestamp = new Date().toISOString();

  const entry: AuditLogEntry = {
    eventId,
    tenantId: input.tenantId,
    timestamp,
    actor: input.actor,
    action: input.action,
    resourceId: input.resourceId,
    resourceType: input.resourceType,
    previousState: input.previousState,
    newState: input.newState,
    metadata: input.metadata,
  };

  await client.put({
    TableName: AUDIT_LOG_TABLE,
    Item: {
      PK: tenantPK(input.tenantId),
      SK: auditSK(timestamp, eventId),
      ...entry,
    },
  });

  logger.info('Audit log entry written', {
    eventId,
    action: input.action,
    resourceId: input.resourceId,
    resourceType: input.resourceType,
  });

  return entry;
}

/**
 * Convenience function to write a lifecycle transition audit log entry.
 *
 * @param client - A tenant-scoped DynamoDB client
 * @param tenantId - The tenant ID
 * @param productId - The product being transitioned
 * @param actor - Who triggered the transition
 * @param fromState - Previous lifecycle state
 * @param toState - New lifecycle state
 */
export async function writeLifecycleAuditLog(
  client: TenantDynamoClient,
  tenantId: string,
  productId: string,
  actor: string,
  fromState: string,
  toState: string
): Promise<AuditLogEntry> {
  return writeAuditLog(client, {
    tenantId,
    actor,
    action: 'product.lifecycle_transition',
    resourceId: productId,
    resourceType: 'product',
    previousState: fromState,
    newState: toState,
  });
}
