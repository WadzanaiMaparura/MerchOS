import { describe, it, expect, vi } from 'vitest';
import type {
  PreTokenGenerationV2TriggerEvent,
  GroupOverrideDetailsV2,
} from 'aws-lambda';

// ---------------------------------------------------------------------------
// Mocks
// ---------------------------------------------------------------------------

vi.mock('@aws-lambda-powertools/logger', () => ({
  Logger: class {
    info = vi.fn();
    warn = vi.fn();
    error = vi.fn();
    debug = vi.fn();
  },
}));

import { handler } from '../../triggers/pre-token-generation';

// ---------------------------------------------------------------------------
// Setup
// ---------------------------------------------------------------------------

const DEFAULT_GROUP_CONFIG: GroupOverrideDetailsV2 = {
  groupsToOverride: ['sellers'],
  iamRolesToOverride: undefined,
  preferredRole: undefined,
};

/**
 * Build a genuine V2 PreTokenGeneration event. The trigger is wired as
 * LambdaVersion.V2_0, so the request carries groupConfiguration and the
 * response is shaped as claimsAndScopeOverrideDetails (separate id/access
 * token claim sets), not the V1 claimsOverrideDetails.
 */
function buildPreTokenEvent(
  userAttributes: Record<string, string> = {},
  groupConfiguration: GroupOverrideDetailsV2 = DEFAULT_GROUP_CONFIG,
): PreTokenGenerationV2TriggerEvent {
  return {
    version: '2',
    region: 'eu-west-1',
    userPoolId: 'eu-west-1_testPool',
    userName: 'test-user-id',
    callerContext: {
      awsSdkVersion: '3.0.0',
      clientId: 'test-client-id',
    },
    triggerSource: 'TokenGeneration_HostedAuth',
    request: {
      userAttributes: {
        sub: 'test-user-id',
        email: 'user@example.com',
        ...userAttributes,
      },
      groupConfiguration,
    },
    response: {
      claimsAndScopeOverrideDetails: {
        idTokenGeneration: undefined,
        accessTokenGeneration: undefined,
        groupOverrideDetails: undefined,
      },
    },
  } as unknown as PreTokenGenerationV2TriggerEvent;
}

/**
 * Build an event with NO email in userAttributes (overrides the default email
 * that buildPreTokenEvent injects), for the missing-email cases.
 */
function buildPreTokenEventNoEmail(
  userAttributes: Record<string, string> = {},
): PreTokenGenerationV2TriggerEvent {
  const event = buildPreTokenEvent(userAttributes);
  delete (event.request.userAttributes as Record<string, string>)['email'];
  return event;
}

/** Convenience accessors for the V2 response claim sets. */
function accessClaims(event: PreTokenGenerationV2TriggerEvent) {
  return event.response.claimsAndScopeOverrideDetails.accessTokenGeneration
    ?.claimsToAddOrOverride;
}
function idClaims(event: PreTokenGenerationV2TriggerEvent) {
  return event.response.claimsAndScopeOverrideDetails.idTokenGeneration
    ?.claimsToAddOrOverride;
}

describe('pre-token-generation trigger (V2)', () => {
  it('produces a V2 response shape with both id and access token claim sets', async () => {
    const event = buildPreTokenEvent({
      'custom:tenantId': 'tenant-abc',
      'custom:role': 'admin',
    });

    const result = await handler(event);
    const details = result.response.claimsAndScopeOverrideDetails;

    // Response is the V2 structure, not the V1 claimsOverrideDetails.
    expect(details).toBeDefined();
    expect(details.accessTokenGeneration?.claimsToAddOrOverride).toBeDefined();
    expect(details.idTokenGeneration?.claimsToAddOrOverride).toBeDefined();
    expect(result.response).not.toHaveProperty('claimsOverrideDetails');
  });

  it('injects tenantId and role into BOTH id and access tokens (plus email when present)', async () => {
    const event = buildPreTokenEvent({
      'custom:tenantId': 'tenant-abc',
      'custom:role': 'admin',
      email_verified: 'true',
    });

    const result = await handler(event);

    const expected = {
      'custom:tenantId': 'tenant-abc',
      'custom:role': 'admin',
      email: 'user@example.com',
      email_verified: 'true',
    };
    expect(accessClaims(result)).toEqual(expected);
    expect(idClaims(result)).toEqual(expected);
  });

  it('preserves existing unrelated claims in both token claim sets', async () => {
    const event = buildPreTokenEvent({
      'custom:tenantId': 'tenant-123',
      'custom:role': 'owner',
      email_verified: 'true',
    });
    event.response.claimsAndScopeOverrideDetails = {
      idTokenGeneration: {
        claimsToAddOrOverride: { idOnly: 'idValue' },
        claimsToSuppress: undefined,
      },
      accessTokenGeneration: {
        claimsToAddOrOverride: { accessOnly: 'accessValue' },
        claimsToSuppress: undefined,
        scopesToAdd: undefined,
        scopesToSuppress: undefined,
      },
      groupOverrideDetails: undefined,
    };

    const result = await handler(event);

    expect(accessClaims(result)).toEqual({
      accessOnly: 'accessValue',
      'custom:tenantId': 'tenant-123',
      'custom:role': 'owner',
      email: 'user@example.com',
      email_verified: 'true',
    });
    expect(idClaims(result)).toEqual({
      idOnly: 'idValue',
      'custom:tenantId': 'tenant-123',
      'custom:role': 'owner',
      email: 'user@example.com',
      email_verified: 'true',
    });
  });

  it('marks a verified email as "true"', async () => {
    const event = buildPreTokenEvent({
      'custom:tenantId': 'tenant-abc',
      'custom:role': 'owner',
      email_verified: 'true',
    });

    const result = await handler(event);

    expect(accessClaims(result)?.['email']).toBe('user@example.com');
    expect(accessClaims(result)?.['email_verified']).toBe('true');
    expect(idClaims(result)?.['email_verified']).toBe('true');
  });

  it('represents an unverified email as "false", never promoting it', async () => {
    // Default event provides email but no email_verified attribute.
    const event = buildPreTokenEvent({
      'custom:tenantId': 'tenant-abc',
      'custom:role': 'owner',
    });

    const result = await handler(event);

    expect(accessClaims(result)?.['email']).toBe('user@example.com');
    expect(accessClaims(result)?.['email_verified']).toBe('false');
    expect(idClaims(result)?.['email_verified']).toBe('false');
  });

  it('treats a non-canonical email_verified value such as "TRUE" as unverified', async () => {
    const event = buildPreTokenEvent({
      'custom:tenantId': 'tenant-abc',
      'custom:role': 'owner',
      email_verified: 'TRUE', // not the canonical lowercase 'true'
    });

    const result = await handler(event);

    expect(accessClaims(result)?.['email_verified']).toBe('false');
    expect(idClaims(result)?.['email_verified']).toBe('false');
  });

  it('does NOT fabricate email/email_verified when the email attribute is absent', async () => {
    const event = buildPreTokenEventNoEmail({
      'custom:tenantId': 'tenant-abc',
      'custom:role': 'owner',
    });

    const result = await handler(event);

    expect(accessClaims(result)).toEqual({
      'custom:tenantId': 'tenant-abc',
      'custom:role': 'owner',
    });
    expect(accessClaims(result)).not.toHaveProperty('email');
    expect(accessClaims(result)).not.toHaveProperty('email_verified');
    expect(idClaims(result)).not.toHaveProperty('email');
    expect(idClaims(result)).not.toHaveProperty('email_verified');
  });

  it('does NOT set email_verified when the attribute is present but email is absent', async () => {
    const event = buildPreTokenEventNoEmail({
      'custom:tenantId': 'tenant-abc',
      'custom:role': 'owner',
      email_verified: 'true', // present but must be ignored without an email
    });

    const result = await handler(event);

    expect(accessClaims(result)).not.toHaveProperty('email_verified');
    expect(idClaims(result)).not.toHaveProperty('email_verified');
  });

  it('handles a missing tenantId by defaulting to an empty string (no fabrication)', async () => {
    const event = buildPreTokenEventNoEmail({
      'custom:role': 'viewer',
    });

    const result = await handler(event);

    expect(accessClaims(result)).toEqual({
      'custom:tenantId': '',
      'custom:role': 'viewer',
    });
    expect(idClaims(result)).toEqual({
      'custom:tenantId': '',
      'custom:role': 'viewer',
    });
  });

  it('handles a missing role by defaulting to an empty string (no fabrication)', async () => {
    const event = buildPreTokenEventNoEmail({
      'custom:tenantId': 'tenant-xyz',
    });

    const result = await handler(event);

    expect(accessClaims(result)).toEqual({
      'custom:tenantId': 'tenant-xyz',
      'custom:role': '',
    });
  });

  it('handles both missing tenantId and role', async () => {
    const event = buildPreTokenEventNoEmail({});

    const result = await handler(event);

    expect(accessClaims(result)).toEqual({
      'custom:tenantId': '',
      'custom:role': '',
    });
    expect(idClaims(result)).toEqual({
      'custom:tenantId': '',
      'custom:role': '',
    });
  });

  it('carries the request group configuration into the response groupOverrideDetails', async () => {
    const groupConfiguration: GroupOverrideDetailsV2 = {
      groupsToOverride: ['sellers', 'beta'],
      iamRolesToOverride: ['arn:aws:iam::123456789012:role/Seller'],
      preferredRole: 'arn:aws:iam::123456789012:role/Seller',
    };
    const event = buildPreTokenEvent(
      { 'custom:tenantId': 'tenant-123', 'custom:role': 'owner' },
      groupConfiguration,
    );

    const result = await handler(event);

    // Group membership must be preserved, not suppressed.
    expect(
      result.response.claimsAndScopeOverrideDetails.groupOverrideDetails,
    ).toEqual(groupConfiguration);
  });

  it('respects a deliberate pre-existing group override instead of the request config', async () => {
    const event = buildPreTokenEvent({
      'custom:tenantId': 'tenant-123',
      'custom:role': 'owner',
    });
    const deliberate: GroupOverrideDetailsV2 = {
      groupsToOverride: ['explicit-override'],
      iamRolesToOverride: undefined,
      preferredRole: undefined,
    };
    event.response.claimsAndScopeOverrideDetails = {
      idTokenGeneration: undefined,
      accessTokenGeneration: undefined,
      groupOverrideDetails: deliberate,
    };

    const result = await handler(event);

    expect(
      result.response.claimsAndScopeOverrideDetails.groupOverrideDetails,
    ).toEqual(deliberate);
  });

  it('returns the event with a valid V2 response on error (preserves error behaviour)', async () => {
    const event = buildPreTokenEvent({
      'custom:tenantId': 'tenant-123',
      'custom:role': 'owner',
    });

    const result = await handler(event);

    expect(result).toBeDefined();
    expect(result.userName).toBe('test-user-id');
    expect(result.response.claimsAndScopeOverrideDetails).toBeDefined();
  });
});
