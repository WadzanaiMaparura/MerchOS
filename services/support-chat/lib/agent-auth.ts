/**
 * Verifies an admin-dashboard Cognito access token for the WebSocket (API
 * Gateway WebSocket APIs have no built-in JWT authorizer). Only members of the
 * Support or Admin groups may open an inbox socket.
 */

import { CognitoJwtVerifier } from 'aws-jwt-verify';
import { config } from './config';

let verifier: { verify: (token: string) => Promise<{ sub: string }> } | undefined;

export async function verifyAgentToken(token: string | undefined): Promise<string | null> {
  if (!token) return null;
  verifier ??= CognitoJwtVerifier.create({
    userPoolId: config.userPoolId,
    tokenUse: 'access',
    clientId: config.adminClientId,
    groups: ['Support', 'Admin'],
  }) as unknown as { verify: (token: string) => Promise<{ sub: string }> };
  try {
    const payload = await verifier.verify(token);
    return payload.sub;
  } catch {
    return null;
  }
}
