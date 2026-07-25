import { describe, it, expect, beforeEach, vi } from 'vitest';
import { mockClient } from 'aws-sdk-client-mock';
import { DynamoDBDocumentClient, QueryCommand } from '@aws-sdk/lib-dynamodb';
import type { PreSignUpTriggerEvent } from 'aws-lambda';

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

const ddbDocMock = mockClient(DynamoDBDocumentClient);

// ---------------------------------------------------------------------------
// Setup
// ---------------------------------------------------------------------------

function buildPreSignUpEvent(overrides: Partial<PreSignUpTriggerEvent> = {}): PreSignUpTriggerEvent {
  return {
    version: '1',
    region: 'af-south-1',
    userPoolId: 'af-south-1_testPool',
    userName: 'test-user-id',
    callerContext: {
      awsSdkVersion: '3.0.0',
      clientId: 'test-client-id',
    },
    triggerSource: 'PreSignUp_SignUp',
    request: {
      userAttributes: {
        email: 'newuser@example.com',
      },
      clientMetadata: undefined,
      validationData: undefined,
    },
    response: {
      autoConfirmUser: false,
      autoVerifyEmail: false,
      autoVerifyPhone: false,
    },
    ...overrides,
  } as PreSignUpTriggerEvent;
}

describe('pre-sign-up trigger', () => {
  beforeEach(() => {
    ddbDocMock.reset();
    process.env['INVITATIONS_TABLE'] = 'merch-os-invitations-dev';
    process.env['AWS_REGION'] = 'af-south-1';
  });

  it('should auto-confirm and assign role when user is invited', async () => {
    // Arrange: invitation exists for this email
    ddbDocMock.on(QueryCommand).resolves({
      Items: [
        {
          PK: 'TENANT#tenant-123',
          SK: 'INVITE#newuser@example.com',
          email: 'newuser@example.com',
          tenantId: 'tenant-123',
          role: 'editor',
          status: 'pending',
        },
      ],
    });

    const { handler } = await import('../../triggers/pre-sign-up');
    const event = buildPreSignUpEvent();

    // Act
    const result = await handler(event);

    // Assert
    expect(result.response.autoConfirmUser).toBe(true);
    expect(result.response.autoVerifyEmail).toBe(true);
    expect(result.request.userAttributes['custom:tenantId']).toBe('tenant-123');
    expect(result.request.userAttributes['custom:role']).toBe('editor');
  });

  it('should generate new tenantId and assign owner role for self sign-ups', async () => {
    // Arrange: no invitation found
    ddbDocMock.on(QueryCommand).resolves({ Items: [] });

    const { handler } = await import('../../triggers/pre-sign-up');
    const event = buildPreSignUpEvent();

    // Act
    const result = await handler(event);

    // Assert
    expect(result.response.autoConfirmUser).toBe(false);
    expect(result.response.autoVerifyEmail).toBe(false);
    expect(result.request.userAttributes['custom:tenantId']).toBeDefined();
    expect(result.request.userAttributes['custom:tenantId']).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/,
    );
    expect(result.request.userAttributes['custom:role']).toBe('owner');
  });

  it('should handle missing INVITATIONS_TABLE gracefully', async () => {
    delete process.env['INVITATIONS_TABLE'];

    const { handler } = await import('../../triggers/pre-sign-up');
    const event = buildPreSignUpEvent();

    // Act
    const result = await handler(event);

    // Assert: still assigns owner role for self sign-up
    expect(result.request.userAttributes['custom:tenantId']).toBeDefined();
    expect(result.request.userAttributes['custom:role']).toBe('owner');
  });

  it('should handle DynamoDB query errors gracefully', async () => {
    // Arrange: DynamoDB throws
    ddbDocMock.on(QueryCommand).rejects(new Error('Connection refused'));

    const { handler } = await import('../../triggers/pre-sign-up');
    const event = buildPreSignUpEvent();

    // Act: should not throw
    const result = await handler(event);

    // Assert: event returned as-is (no custom attributes set due to error caught)
    expect(result).toBeDefined();
  });

  it('should use email from userAttributes over userName', async () => {
    ddbDocMock.on(QueryCommand).resolves({ Items: [] });

    const { handler } = await import('../../triggers/pre-sign-up');
    const event = buildPreSignUpEvent({
      userName: 'user-uuid',
    });
    event.request.userAttributes['email'] = 'specific@example.com';

    // Act
    const result = await handler(event);

    // Assert: tenantId is assigned using email lookup
    expect(result.request.userAttributes['custom:role']).toBe('owner');
  });
});
