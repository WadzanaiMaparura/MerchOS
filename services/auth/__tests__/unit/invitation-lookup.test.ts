import { describe, it, expect, beforeEach } from 'vitest';
import { mockClient } from 'aws-sdk-client-mock';
import { DynamoDBDocumentClient, QueryCommand } from '@aws-sdk/lib-dynamodb';

import {
  findGenuineInvitationByEmail,
  AmbiguousInvitationError,
  InvitationLookupError,
} from '../../registration/invitation-lookup';

const ddbMock = mockClient(DynamoDBDocumentClient);
const NOW = Math.floor(Date.now() / 1000);

function invite(overrides: Record<string, unknown> = {}) {
  return {
    PK: 'TENANT#t1',
    SK: 'INVITE#seller@example.com',
    email: 'seller@example.com',
    tenantId: 't1',
    role: 'editor',
    status: 'pending',
    expiresAt: NOW + 3600,
    ...overrides,
  };
}

describe('findGenuineInvitationByEmail', () => {
  beforeEach(() => {
    ddbMock.reset();
    process.env['INVITATIONS_TABLE'] = 'merch-os-invitations-dev';
    process.env['AWS_REGION'] = 'eu-west-1';
  });

  it('does not let an EXPIRED record mask another VALID invitation for the same email', async () => {
    ddbMock.on(QueryCommand).resolves({
      Items: [
        invite({ PK: 'TENANT#t1', tenantId: 't1', expiresAt: NOW - 100 }), // expired, listed first
        invite({ PK: 'TENANT#t1', tenantId: 't1', expiresAt: NOW + 3600 }), // valid
      ],
    });

    const result = await findGenuineInvitationByEmail('seller@example.com');
    expect(result).not.toBeNull();
    expect(result!.tenantId).toBe('t1');
    expect(result!.expiresAt).toBe(NOW + 3600);
  });

  it('fails closed when multiple VALID invitations point to DIFFERENT tenants', async () => {
    ddbMock.on(QueryCommand).resolves({
      Items: [
        invite({ PK: 'TENANT#t1', tenantId: 't1' }),
        invite({ PK: 'TENANT#t2', tenantId: 't2' }),
      ],
    });

    await expect(findGenuineInvitationByEmail('seller@example.com')).rejects.toBeInstanceOf(
      AmbiguousInvitationError,
    );
  });

  it('aggregates results across pagination before deciding', async () => {
    ddbMock
      .on(QueryCommand)
      .resolvesOnce({
        Items: [invite({ expiresAt: NOW - 50 })], // expired on page 1
        LastEvaluatedKey: { PK: 'x', SK: 'y' },
      })
      .resolvesOnce({
        Items: [invite({ expiresAt: NOW + 7200 })], // valid on page 2
      });

    const result = await findGenuineInvitationByEmail('seller@example.com');
    expect(result).not.toBeNull();
    expect(result!.tenantId).toBe('t1');
    // Two Query calls were made (pagination followed).
    expect(ddbMock.commandCalls(QueryCommand)).toHaveLength(2);
  });

  it('returns null when there is no valid invitation (self-registration recovery)', async () => {
    ddbMock.on(QueryCommand).resolves({
      Items: [
        invite({ expiresAt: NOW - 100 }), // expired
        invite({ status: 'revoked' }), // wrong status
        { PK: 'PENDINGREG#x', SK: 'METADATA', email: 'seller@example.com', status: 'pending', tenantId: 'z', role: 'owner', expiresAt: NOW + 10 }, // not an invite shape
      ],
    });

    const result = await findGenuineInvitationByEmail('seller@example.com');
    expect(result).toBeNull();
  });

  it('returns the single valid invitation when exactly one exists', async () => {
    ddbMock.on(QueryCommand).resolves({ Items: [invite()] });
    const result = await findGenuineInvitationByEmail('seller@example.com');
    expect(result!.tenantId).toBe('t1');
    expect(result!.role).toBe('editor');
  });

  it('throws InvitationLookupError when the table is not configured', async () => {
    delete process.env['INVITATIONS_TABLE'];
    await expect(findGenuineInvitationByEmail('seller@example.com')).rejects.toBeInstanceOf(
      InvitationLookupError,
    );
  });

  it('throws InvitationLookupError when the query fails', async () => {
    ddbMock.on(QueryCommand).rejects(new Error('kms denied'));
    await expect(findGenuineInvitationByEmail('seller@example.com')).rejects.toBeInstanceOf(
      InvitationLookupError,
    );
  });
});
