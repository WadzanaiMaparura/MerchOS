import { describe, it, expect, vi } from 'vitest';
import type { PreTokenGenerationV2TriggerEvent } from 'aws-lambda';

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

function buildPreTokenEvent(
  userAttributes: Record<string, string> = {},
  groupConfiguration?: {
    groupsToOverride?: string[];
    iamRolesToOverride?: string[];
    preferredRole?: string;
  },
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
    triggerSource: 'TokenGeneration_Authentication',
    request: {
      userAttributes: {
        sub: 'test-user-id',
        email: 'user@example.com',
        ...userAttributes,
      },
      groupConfiguration: groupConfiguration ?? {
        groupsToOverride: undefined,
        iamRolesToOverride: undefined,
        preferredRole: undefined,
      },
    },
    response: {
      claimsAndScopeOverrideDetails: {},
    },
  } as unknown as PreTokenGenerationV2TriggerEvent;
}

describe('pre-token-generation trigger (V2_0)', () => {
  it('should inject tenantId and role into access token claims', async () => {
    const event = buildPreTokenEvent({
      'custom:tenantId': 'tenant-abc',
      'custom:role': 'admin',
    });

    const result = await handler(event);

    expect(
      result.response.claimsAndScopeOverrideDetails?.accessTokenGeneration
        ?.claimsToAddOrOverride,
    ).toEqual({
      'custom:tenantId': 'tenant-abc',
      'custom:role': 'admin',
    });
  });

  it('should handle missing tenantId gracefully', async () => {
    const event = buildPreTokenEvent({
      'custom:role': 'viewer',
    });

    const result = await handler(event);

    expect(
      result.response.claimsAndScopeOverrideDetails?.accessTokenGeneration
        ?.claimsToAddOrOverride,
    ).toEqual({
      'custom:tenantId': '',
      'custom:role': 'viewer',
    });
  });

  it('should handle missing role gracefully', async () => {
    const event = buildPreTokenEvent({
      'custom:tenantId': 'tenant-xyz',
    });

    const result = await handler(event);

    expect(
      result.response.claimsAndScopeOverrideDetails?.accessTokenGeneration
        ?.claimsToAddOrOverride,
    ).toEqual({
      'custom:tenantId': 'tenant-xyz',
      'custom:role': '',
    });
  });

  it('should handle both missing tenantId and role', async () => {
    const event = buildPreTokenEvent({});

    const result = await handler(event);

    expect(
      result.response.claimsAndScopeOverrideDetails?.accessTokenGeneration
        ?.claimsToAddOrOverride,
    ).toEqual({
      'custom:tenantId': '',
      'custom:role': '',
    });
  });

  it('should preserve existing access-token claims rather than overwriting them', async () => {
    const event = buildPreTokenEvent({
      'custom:tenantId': 'tenant-123',
      'custom:role': 'owner',
    });
    // Set existing V2_0 access-token claims
    event.response.claimsAndScopeOverrideDetails = {
      accessTokenGeneration: {
        claimsToAddOrOverride: {
          existingClaim: 'existingValue',
        },
      },
    };

    const result = await handler(event);

    expect(
      result.response.claimsAndScopeOverrideDetails?.accessTokenGeneration
        ?.claimsToAddOrOverride,
    ).toEqual({
      existingClaim: 'existingValue',
      'custom:tenantId': 'tenant-123',
      'custom:role': 'owner',
    });
  });

  it('should return the event unchanged on error', async () => {
    const event = buildPreTokenEvent({
      'custom:tenantId': 'tenant-123',
      'custom:role': 'owner',
    });

    // Even with a normal event, handler should succeed
    const result = await handler(event);
    expect(result).toBeDefined();
    expect(result.userName).toBe('test-user-id');
  });

  // -------------------------------------------------------------------------
  // Group projection (cognito:groups via groupOverrideDetails)
  // -------------------------------------------------------------------------

  it('should project the user\'s group membership into the token via groupOverrideDetails', async () => {
    const event = buildPreTokenEvent(
      { 'custom:tenantId': 'tenant-abc', 'custom:role': 'seller' },
      { groupsToOverride: ['Seller'], iamRolesToOverride: undefined, preferredRole: undefined },
    );

    const result = await handler(event);

    // groupOverrideDetails is copied from request.groupConfiguration (preserves groups)
    expect(result.response.claimsAndScopeOverrideDetails?.groupOverrideDetails).toEqual({
      groupsToOverride: ['Seller'],
      iamRolesToOverride: undefined,
      preferredRole: undefined,
    });
    expect(
      result.response.claimsAndScopeOverrideDetails?.groupOverrideDetails?.groupsToOverride,
    ).toContain('Seller');
  });

  it('should still inject custom:tenantId and custom:role alongside group projection', async () => {
    const event = buildPreTokenEvent(
      { 'custom:tenantId': 'tenant-abc', 'custom:role': 'seller' },
      { groupsToOverride: ['Seller'] },
    );

    const result = await handler(event);

    // Custom claims unchanged by the group-projection addition
    expect(
      result.response.claimsAndScopeOverrideDetails?.accessTokenGeneration
        ?.claimsToAddOrOverride,
    ).toEqual({
      'custom:tenantId': 'tenant-abc',
      'custom:role': 'seller',
    });
    // Groups preserved
    expect(
      result.response.claimsAndScopeOverrideDetails?.groupOverrideDetails?.groupsToOverride,
    ).toEqual(['Seller']);
  });

  it('should preserve multiple groups and not suppress them', async () => {
    const event = buildPreTokenEvent(
      { 'custom:tenantId': 'tenant-abc', 'custom:role': 'seller' },
      { groupsToOverride: ['Seller', 'Admin'] },
    );

    const result = await handler(event);

    const projected = result.response.claimsAndScopeOverrideDetails?.groupOverrideDetails;
    // Not an empty/null object (which would SUPPRESS groups in Cognito)
    expect(projected).toBeDefined();
    expect(projected?.groupsToOverride).toEqual(['Seller', 'Admin']);
    expect(projected?.groupsToOverride?.length).toBe(2);
  });

  it('should pass through an empty group configuration unchanged (no invented groups)', async () => {
    // Default fixture: groupConfiguration with all-undefined fields.
    const event = buildPreTokenEvent({ 'custom:tenantId': 'tenant-abc', 'custom:role': 'seller' });

    const result = await handler(event);

    // groupOverrideDetails equals the request's groupConfiguration (pass-through),
    // the handler does not fabricate groups.
    expect(result.response.claimsAndScopeOverrideDetails?.groupOverrideDetails).toEqual({
      groupsToOverride: undefined,
      iamRolesToOverride: undefined,
      preferredRole: undefined,
    });
  });
});
