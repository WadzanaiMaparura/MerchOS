/**
 * Read-only helpers backing GET /auth/profile-status and the invited-user
 * safeguard shared by POST /auth/complete-profile.
 *
 * Uses the raw DynamoDBDocumentClient (not TenantDynamoClient) for simple,
 * explicit GetItem reads against the tenants and invitations tables.
 */

import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { DynamoDBDocumentClient, GetCommand } from '@aws-sdk/lib-dynamodb';

import { tenantPK, userSK } from '../../shared/utils/dynamo-client';
import type {
  TenantMetadataRecord,
  OwnerProfileRecord,
} from '../../shared/types/registration.types';

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

export function resetProfileStatusRepositoryClient(): void {
  docClient = null;
}

export interface AuthedIdentity {
  userId: string;
  email: string;
  tenantId: string;
  role: string;
}

/**
 * Look up an invitation record for this tenant+email.
 * Invitations are keyed PK=TENANT#<tenantId>, SK=INVITE#<email> in the
 * INVITATIONS_TABLE. Presence of this record is the authoritative signal that
 * the account is invitation-linked (joins an existing tenant) and must NOT be
 * routed into the self-registration owner-creation flow.
 */
export async function findInvitation(
  invitationsTable: string,
  tenantId: string,
  email: string,
): Promise<{ role?: string; status?: string } | null> {
  const result = await getDocClient().send(
    new GetCommand({
      TableName: invitationsTable,
      Key: { PK: tenantPK(tenantId), SK: `INVITE#${email}` },
    }),
  );
  if (!result.Item) return null;
  return result.Item as { role?: string; status?: string };
}

export interface DurableProfileState {
  metadata: TenantMetadataRecord | undefined;
  owner: OwnerProfileRecord | undefined;
}

/** Read tenant metadata + the caller's owner profile from the tenants table. */
export async function readProfileState(
  tenantsTable: string,
  tenantId: string,
  userId: string,
): Promise<DurableProfileState> {
  const pk = tenantPK(tenantId);
  const client = getDocClient();

  const [meta, owner] = await Promise.all([
    client.send(new GetCommand({ TableName: tenantsTable, Key: { PK: pk, SK: 'METADATA' } })),
    client.send(
      new GetCommand({ TableName: tenantsTable, Key: { PK: pk, SK: userSK(userId) } }),
    ),
  ]);

  return {
    metadata: meta.Item as TenantMetadataRecord | undefined,
    owner: owner.Item as OwnerProfileRecord | undefined,
  };
}

/**
 * Classify a confirmed user's registration/profile state.
 *
 * Precedence:
 *  1. not_verified  — email not verified (defensive; JWT normally implies verified).
 *  2. complete      — metadata + owner exist AND owner belongs to THIS subject.
 *  3. conflict      — records exist but owner belongs to a different subject, or
 *                     metadata exists owned by someone else, or partial state.
 *  4. invited       — an invitation record exists for this tenant+email.
 *  5. needs_profile_completion — genuine self-registration owner, records absent.
 */
export function classifyProfileState(
  identity: AuthedIdentity,
  emailVerified: boolean,
  state: DurableProfileState,
  invitation: { status?: string } | null,
): 'complete' | 'needs_profile_completion' | 'invited' | 'not_verified' | 'conflict' {
  if (!emailVerified) return 'not_verified';

  const ownerIsUs =
    state.owner?.userId === identity.userId && state.owner?.tenantId === identity.tenantId;
  const metadataOwnedByUs =
    state.metadata?.ownerUserId === identity.userId &&
    state.metadata?.tenantId === identity.tenantId;

  if (state.metadata && state.owner && ownerIsUs && metadataOwnedByUs) {
    return 'complete';
  }

  // Records exist but don't belong to this subject, or are partially present.
  if ((state.owner && !ownerIsUs) || (state.metadata && !metadataOwnedByUs)) {
    return 'conflict';
  }
  if (state.metadata && !state.owner) {
    // Tenant exists (e.g. created by another member/invite) without this
    // user's profile — do not treat as a self-registration owner.
    return invitation ? 'invited' : 'conflict';
  }

  // No durable records yet. If an invitation exists, this is an invited user.
  if (invitation) return 'invited';

  return 'needs_profile_completion';
}
