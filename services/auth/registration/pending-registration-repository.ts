/**
 * Pending-registration repository.
 *
 * Dedicated registration-persistence layer backed by a raw DynamoDB document
 * client. This is deliberately NOT routed through TenantDynamoClient: pending
 * registrations exist before a tenant context is established and before the
 * Cognito account is verified, so the tenant-isolation write conditions that
 * TenantDynamoClient enforces do not apply. TenantDynamoClient is left
 * unchanged.
 *
 * Storage: the existing tenants table (merch-os-tenants-<env>), under the
 * approved key:
 *   PK = `PENDINGREG#<registrationId>`, SK = `METADATA`.
 *
 * Records are resolved by registrationId only (no email GSI). Email is stored
 * for correlation against the verified Cognito identity, not for lookup, so a
 * pending record can never be mis-selected by email.
 */

import crypto from 'node:crypto';
import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import {
  DynamoDBDocumentClient,
  PutCommand,
  GetCommand,
  DeleteCommand,
} from '@aws-sdk/lib-dynamodb';

import type {
  PendingRegistrationRecord,
  CreatePendingRegistrationInput,
  CreatePendingRegistrationResult,
} from './types';

/** Approved pending-registration TTL: ~1 hour (seconds). */
export const PENDING_REGISTRATION_TTL_SECONDS = 60 * 60;

/** Builds the partition key for a pending-registration record. */
export function pendingRegistrationPK(registrationId: string): string {
  return `PENDINGREG#${registrationId}`;
}

/** Resolves the tenants table name from configuration. */
function resolveTableName(explicit?: string): string {
  const tableName = explicit ?? process.env['TENANTS_TABLE'];
  if (!tableName) {
    throw new Error(
      'PendingRegistrationRepository requires a table name (TENANTS_TABLE).'
    );
  }
  return tableName;
}

export class PendingRegistrationRepository {
  private readonly docClient: DynamoDBDocumentClient;
  private readonly tableName: string;
  private readonly ttlSeconds: number;

  constructor(options?: {
    tableName?: string;
    docClient?: DynamoDBDocumentClient;
    ttlSeconds?: number;
  }) {
    this.tableName = resolveTableName(options?.tableName);
    this.ttlSeconds = options?.ttlSeconds ?? PENDING_REGISTRATION_TTL_SECONDS;

    this.docClient =
      options?.docClient ??
      DynamoDBDocumentClient.from(
        new DynamoDBClient({ region: process.env['AWS_REGION'] ?? 'eu-west-1' }),
        { marshallOptions: { removeUndefinedValues: true } }
      );
  }

  /**
   * Creates a new pending-registration record with server-generated
   * registrationId and tenantId. Never stores password or verification code.
   */
  async create(
    input: CreatePendingRegistrationInput
  ): Promise<CreatePendingRegistrationResult & { tenantId: string }> {
    const registrationId = crypto.randomUUID();
    const tenantId = crypto.randomUUID();
    const nowMs = Date.now();
    const expiresAt = Math.floor(nowMs / 1000) + this.ttlSeconds;

    const record: PendingRegistrationRecord = {
      PK: pendingRegistrationPK(registrationId),
      SK: 'METADATA',
      registrationId,
      tenantId,
      email: input.email,
      fullName: input.fullName,
      phoneNumber: input.phoneNumber,
      organisationName: input.organisationName,
      marketingConsent: {
        granted: input.marketingConsent,
        capturedAt: new Date(nowMs).toISOString(),
      },
      status: 'pending',
      createdAt: new Date(nowMs).toISOString(),
      expiresAt,
    };

    await this.docClient.send(
      new PutCommand({
        TableName: this.tableName,
        Item: record,
        // Guard against an (astronomically unlikely) id collision.
        ConditionExpression: 'attribute_not_exists(PK)',
      })
    );

    return { registrationId, tenantId };
  }

  /**
   * Fetches a pending registration by its exact registrationId.
   * Returns null when no record exists for that id.
   */
  async getById(registrationId: string): Promise<PendingRegistrationRecord | null> {
    const result = await this.docClient.send(
      new GetCommand({
        TableName: this.tableName,
        Key: { PK: pendingRegistrationPK(registrationId), SK: 'METADATA' },
      })
    );
    return (result.Item as PendingRegistrationRecord | undefined) ?? null;
  }

  /**
   * Deletes a pending registration (idempotent — missing item is a no-op).
   *
   * NOTE: callers must only invoke this AFTER the durable downstream completion
   * path (tenant metadata + owner profile + consent) has committed. It must not
   * be called merely after assigning Cognito attributes.
   */
  async deleteById(registrationId: string): Promise<void> {
    await this.docClient.send(
      new DeleteCommand({
        TableName: this.tableName,
        Key: { PK: pendingRegistrationPK(registrationId), SK: 'METADATA' },
      })
    );
  }

  /** Returns true when a record's TTL is in the past. */
  static isExpired(
    record: Pick<PendingRegistrationRecord, 'expiresAt'>,
    nowSeconds: number = Math.floor(Date.now() / 1000)
  ): boolean {
    return record.expiresAt <= nowSeconds;
  }
}
