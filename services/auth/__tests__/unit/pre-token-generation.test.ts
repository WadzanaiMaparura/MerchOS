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

/**
 * Builds a V2_0 PreTokenGeneration event. The V2 trigger carries custom-claim
 * overrides under `response.claimsAndScopeOverrideDetails.accessTokenGeneration`
 * (the shape that actually writes claims into the ACCESS token).
 */
function buildPreTokenEvent(
  userAttributes: Record<string, string> = {},
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
      groupConfiguration: {
        groupsToOverride: [],
        iamRolesToOverride: [],
        preferredRole: undefined,
      },
      scopes: [],
    },
    response: {
      claimsAndScopeOverrideDetails: {},
    },
  } as unknown as PreTokenGenerationV2TriggerEvent;
}

/** Shorthand accessor for the access-token claim overrides the handler writes. */
function accessClaims(result: PreTokenGenerationV2TriggerEvent) {
  return result.response.claimsAndScopeOverrideDetails?.accessTokenGeneration
    ?.claimsToAddOrOverride;
}

describe('pre-token-generation trigger (V2_0)', () => {
  it('should inject tenantId and role into ACCESS token claims', async () => {
    const event = buildPreTokenEvent({
      'custom:tenantId': 'tenant-abc',
      'custom:role': 'admin',
    });

    const result = await handler(event);

    expect(accessClaims(result)).toEqual({
      'custom:tenantId': 'tenant-abc',
      'custom:role': 'admin',
    });
  });

  it('maps the server-managed custom:tenantIdAssigned onto the custom:tenantId claim (self-signup)', async () => {
    const event = buildPreTokenEvent({
      'custom:tenantIdAssigned': 'assigned-tenant-1',
      'custom:role': 'owner',
    });

    const result = await handler(event);

    expect(accessClaims(result)).toEqual({
      'custom:tenantId': 'assigned-tenant-1',
      'custom:role': 'owner',
    });
  });

  it('prefers the immutable custom:tenantId over custom:tenantIdAssigned (invited user)', async () => {
    const event = buildPreTokenEvent({
      'custom:tenantId': 'invited-tenant',
      'custom:tenantIdAssigned': 'should-be-ignored',
      'custom:role': 'editor',
    });

    const result = await handler(event);

    expect(accessClaims(result)?.['custom:tenantId']).toBe('invited-tenant');
  });

  it('should handle missing tenantId gracefully', async () => {
    const event = buildPreTokenEvent({ 'custom:role': 'viewer' });

    const result = await handler(event);

    expect(accessClaims(result)).toEqual({
      'custom:tenantId': '',
      'custom:role': 'viewer',
    });
  });

  it('should handle missing role gracefully', async () => {
    const event = buildPreTokenEvent({ 'custom:tenantId': 'tenant-xyz' });

    const result = await handler(event);

    expect(accessClaims(result)).toEqual({
      'custom:tenantId': 'tenant-xyz',
      'custom:role': '',
    });
  });

  it('should handle both missing tenantId and role', async () => {
    const event = buildPreTokenEvent({});

    const result = await handler(event);

    expect(accessClaims(result)).toEqual({
      'custom:tenantId': '',
      'custom:role': '',
    });
  });

  it('should preserve existing accessTokenGeneration claim overrides', async () => {
    const event = buildPreTokenEvent({
      'custom:tenantId': 'tenant-123',
      'custom:role': 'owner',
    });
    event.response.claimsAndScopeOverrideDetails = {
      accessTokenGeneration: {
        claimsToAddOrOverride: { existingClaim: 'existingValue' },
      },
    };

    const result = await handler(event);

    expect(accessClaims(result)).toEqual({
      existingClaim: 'existingValue',
      'custom:tenantId': 'tenant-123',
      'custom:role': 'owner',
    });
  });

  it('should return the event with userName intact', async () => {
    const event = buildPreTokenEvent({
      'custom:tenantId': 'tenant-123',
      'custom:role': 'owner',
    });

    const result = await handler(event);
    expect(result).toBeDefined();
    expect(result.userName).toBe('test-user-id');
  });
});
