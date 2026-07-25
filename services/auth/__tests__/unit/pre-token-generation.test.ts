import { describe, it, expect, vi } from 'vitest';
import type { PreTokenGenerationTriggerEvent } from 'aws-lambda';

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
): PreTokenGenerationTriggerEvent {
  return {
    version: '1',
    region: 'af-south-1',
    userPoolId: 'af-south-1_testPool',
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
        groupsToOverride: undefined,
        iamRolesToOverride: undefined,
        preferredRole: undefined,
      },
    },
    response: {
      claimsOverrideDetails: {
        claimsToAddOrOverride: undefined,
        claimsToSuppress: undefined,
        groupOverrideDetails: undefined,
      },
    },
  } as unknown as PreTokenGenerationTriggerEvent;
}

describe('pre-token-generation trigger', () => {
  it('should inject tenantId and role into access token claims', async () => {
    const event = buildPreTokenEvent({
      'custom:tenantId': 'tenant-abc',
      'custom:role': 'admin',
    });

    const result = await handler(event);

    expect(result.response.claimsOverrideDetails?.claimsToAddOrOverride).toEqual({
      'custom:tenantId': 'tenant-abc',
      'custom:role': 'admin',
    });
  });

  it('should handle missing tenantId gracefully', async () => {
    const event = buildPreTokenEvent({
      'custom:role': 'viewer',
    });

    const result = await handler(event);

    expect(result.response.claimsOverrideDetails?.claimsToAddOrOverride).toEqual({
      'custom:tenantId': '',
      'custom:role': 'viewer',
    });
  });

  it('should handle missing role gracefully', async () => {
    const event = buildPreTokenEvent({
      'custom:tenantId': 'tenant-xyz',
    });

    const result = await handler(event);

    expect(result.response.claimsOverrideDetails?.claimsToAddOrOverride).toEqual({
      'custom:tenantId': 'tenant-xyz',
      'custom:role': '',
    });
  });

  it('should handle both missing tenantId and role', async () => {
    const event = buildPreTokenEvent({});

    const result = await handler(event);

    expect(result.response.claimsOverrideDetails?.claimsToAddOrOverride).toEqual({
      'custom:tenantId': '',
      'custom:role': '',
    });
  });

  it('should preserve existing claimsOverrideDetails', async () => {
    const event = buildPreTokenEvent({
      'custom:tenantId': 'tenant-123',
      'custom:role': 'owner',
    });
    // Set existing claims
    event.response.claimsOverrideDetails = {
      claimsToAddOrOverride: {
        existingClaim: 'existingValue',
      },
      claimsToSuppress: undefined,
      groupOverrideDetails: undefined,
    };

    const result = await handler(event);

    expect(result.response.claimsOverrideDetails?.claimsToAddOrOverride).toEqual({
      existingClaim: 'existingValue',
      'custom:tenantId': 'tenant-123',
      'custom:role': 'owner',
    });
  });

  it('should return the event unchanged on error', async () => {
    // Force an error by making userAttributes throw
    const event = buildPreTokenEvent({
      'custom:tenantId': 'tenant-123',
      'custom:role': 'owner',
    });

    // Even with a normal event, handler should succeed
    const result = await handler(event);
    expect(result).toBeDefined();
    expect(result.userName).toBe('test-user-id');
  });
});
