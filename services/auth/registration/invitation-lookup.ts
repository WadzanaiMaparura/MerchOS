/**
 * Shared invitation lookup + validation used by the PreSignUp and
 * PostConfirmation triggers so both agree on what counts as a GENUINE,
 * non-expired invitation. Centralising this avoids drift between the two code
 * paths that must treat invited users identically.
 */

import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { DynamoDBDocumentClient, QueryCommand } from '@aws-sdk/lib-dynamodb';

export interface InvitationRecord {
  PK: string;
  SK: string;
  email: string;
  tenantId: string;
  role: string;
  status: string;
  /** Unix epoch SECONDS (current) or legacy ISO-8601 string. */
  expiresAt?: number | string;
}

/** Raised when the invitation lookup itself fails (DynamoDB/KMS error). */
export class InvitationLookupError extends Error {
  constructor(message: string, public readonly cause?: unknown) {
    super(message);
    this.name = 'InvitationLookupError';
  }
}

/**
 * Parses an invitation expiry into Unix epoch SECONDS.
 * Accepts numeric epoch seconds (current) or an ISO-8601 string (legacy).
 * Returns null for missing / wrong-typed / unparseable values so callers can
 * fail closed.
 */
export function parseExpiryToEpochSeconds(value: unknown): number | null {
  if (typeof value === 'number') {
    return Number.isFinite(value) ? value : null;
  }
  if (typeof value === 'string' && value.trim().length > 0) {
    const ms = Date.parse(value);
    return Number.isNaN(ms) ? null : Math.floor(ms / 1000);
  }
  return null;
}

/**
 * Returns true only when the record is unambiguously a genuine, non-expired
 * invitation: correct key shape (PK TENANT#..., SK INVITE#...), non-empty
 * tenantId + role, status 'pending', and a valid non-expired expiry.
 */
export function isValidInvitation(
  candidate: Partial<InvitationRecord> | undefined,
  nowSeconds: number = Math.floor(Date.now() / 1000),
): candidate is InvitationRecord {
  if (!candidate) return false;
  const shapeOk =
    typeof candidate.PK === 'string' && candidate.PK.startsWith('TENANT#') &&
    typeof candidate.SK === 'string' && candidate.SK.startsWith('INVITE#') &&
    typeof candidate.tenantId === 'string' && candidate.tenantId.length > 0 &&
    typeof candidate.role === 'string' && candidate.role.length > 0 &&
    candidate.status === 'pending';
  if (!shapeOk) return false;

  // Expiry must be present and valid; missing/malformed fails closed.
  const expiresAtSeconds = parseExpiryToEpochSeconds(candidate.expiresAt);
  if (expiresAtSeconds === null) return false;
  return expiresAtSeconds > nowSeconds;
}

let ddbDocClient: DynamoDBDocumentClient | null = null;
function getDocClient(): DynamoDBDocumentClient {
  if (!ddbDocClient) {
    ddbDocClient = DynamoDBDocumentClient.from(
      new DynamoDBClient({ region: process.env['AWS_REGION'] ?? 'eu-west-1' }),
    );
  }
  return ddbDocClient;
}

/** Allow tests to inject a mocked doc client. */
export function __setInvitationDocClientForTesting(client: DynamoDBDocumentClient | null): void {
  ddbDocClient = client;
}

/**
 * Looks up a pending invitation for an email via the invitations table
 * email-index GSI.
 *
 * Returns the record only when it is a GENUINE, non-expired invitation.
 * Returns null on a successful lookup with no (valid) invitation.
 * Throws InvitationLookupError when the lookup FAILS (DynamoDB/KMS) or when the
 * table is not configured — callers must fail closed on this.
 */
export async function findGenuineInvitationByEmail(
  email: string,
): Promise<InvitationRecord | null> {
  const invitationsTable = process.env['INVITATIONS_TABLE'];
  if (!invitationsTable) {
    throw new InvitationLookupError('INVITATIONS_TABLE is not configured');
  }

  let result;
  try {
    result = await getDocClient().send(
      new QueryCommand({
        TableName: invitationsTable,
        IndexName: 'email-index',
        KeyConditionExpression: 'email = :email',
        FilterExpression: '#status = :status',
        ExpressionAttributeNames: { '#status': 'status' },
        ExpressionAttributeValues: { ':email': email, ':status': 'pending' },
        Limit: 1,
      }),
    );
  } catch (error) {
    throw new InvitationLookupError('Invitation lookup failed', error);
  }

  const candidate = result.Items?.[0] as Partial<InvitationRecord> | undefined;
  return isValidInvitation(candidate) ? candidate : null;
}
