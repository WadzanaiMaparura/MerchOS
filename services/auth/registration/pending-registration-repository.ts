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
 * Storage reuses the invitations table (CMK-encrypted, TTL-enabled, with an
 * `email-index` GSI) under a distinct key prefix:
 *   PK = `PENDINGREG#<registrationId>`, SK = `METADATA`.
 */

import crypto from 'node:crypto';
import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import {
  DynamoDBDocumentClient,
  PutCommand,
  GetCommand,
  DeleteCommand,
  QueryCommand,
} from '@aws-sdk/lib-dynamodb';

import type {
  PendingRegistrationRecord,
  CreatePendingRegistrationInput,
  CreatePendingRegistrationResult,
} from './types';

/** Default pending-registration TTL: 24 hours (seconds). */
export const PENDING_REGISTRATION_TTL_SECONDS = 24 * 60 * 60;

/** Builds the partition key for a pending-registration record. */
export function pendingRegistrationPK(registrationId: string): string {
  return `PENDINGREG#${registrationId}`;
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
    const tableName = options?.tableName ?? process.env['INVITATIONS_TABLE'];
    if (!tableName) {
      throw new Error(
        'PendingRegistrationRepository requires a table name (INVITATIONS_TABLE).'
      );
    }
    this.tableName = tableName;
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

  /** Fetches a pending registration by its registrationId. */
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
   * Finds the most recent, non-expired pending registration for a verified
   * email. Returns null when none match or all have expired.
   *
   * Expiry is enforced in code as well as by DynamoDB TTL, because TTL deletion
   * is not instantaneous and an expired item may still be readable.
   */
  async findActiveByEmail(email: string): Promise<PendingRegistrationRecord | null> {
    const result = await this.docClient.send(
      new QueryCommand({
        TableName: this.tableName,
        IndexName: 'email-index',
        KeyConditionExpression: 'email = :email',
        FilterExpression: 'SK = :sk AND #status = :status',
        ExpressionAttributeNames: { '#status': 'status' },
        ExpressionAttributeValues: {
          ':email': email,
          ':sk': 'METADATA',
          ':status': 'pending',
        },
      })
    );

    const items = (result.Items as PendingRegistrationRecord[] | undefined) ?? [];
    const pendingRegistrations = items.filter(
      (item) => typeof item.PK === 'string' && item.PK.startsWith('PENDINGREG#')
    );
    if (pendingRegistrations.length === 0) {
      return null;
    }

    const nowSeconds = Math.floor(Date.now() / 1000);
    const active = pendingRegistrations
      .filter((item) => item.expiresAt > nowSeconds)
      .sort((a, b) => b.createdAt.localeCompare(a.createdAt));

    return active[0] ?? null;
  }

  /** Deletes a pending registration (idempotent — missing item is a no-op). */
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
