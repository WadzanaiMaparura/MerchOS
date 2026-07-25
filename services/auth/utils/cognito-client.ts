/**
 * CognitoIdentityProviderClient factory for the MerchOS auth service.
 *
 * Provides a singleton client instance configured with the appropriate
 * AWS region. All auth handlers should import the client from this module
 * to avoid creating multiple connections.
 */

import {
  CognitoIdentityProviderClient,
  CognitoIdentityProviderClientConfig,
} from '@aws-sdk/client-cognito-identity-provider';

const DEFAULT_REGION = 'af-south-1';

let clientInstance: CognitoIdentityProviderClient | null = null;

/**
 * Returns a singleton CognitoIdentityProviderClient.
 *
 * The client is configured with the region from the AWS_REGION environment
 * variable, falling back to 'af-south-1' if not set.
 *
 * Uses a singleton pattern to reuse the underlying HTTP connection pool
 * across Lambda invocations within the same execution context.
 */
export function getCognitoClient(
  config?: CognitoIdentityProviderClientConfig
): CognitoIdentityProviderClient {
  if (!clientInstance) {
    clientInstance = new CognitoIdentityProviderClient({
      region: process.env['AWS_REGION'] ?? DEFAULT_REGION,
      ...config,
    });
  }
  return clientInstance;
}

/**
 * Resets the singleton client instance.
 * Useful for testing to ensure a fresh client is created.
 */
export function resetCognitoClient(): void {
  clientInstance = null;
}

/** Re-export the client type for handler use. */
export type { CognitoIdentityProviderClient } from '@aws-sdk/client-cognito-identity-provider';
