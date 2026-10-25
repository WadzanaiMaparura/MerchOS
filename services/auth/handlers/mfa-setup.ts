/**
 * MFA Setup Lambda handler for POST /auth/mfa/setup.
 *
 * Implements a two-step self-service TOTP MFA setup flow for the authenticated
 * caller. Both steps are driven by the caller's own access token (taken from
 * the Authorization header) — not an admin API and not a challenge session,
 * because the user is already signed in:
 * 1. Associate: empty body → AssociateSoftwareToken(AccessToken) → returns the
 *    secret code for the authenticator-app QR.
 * 2. Verify: { verificationCode } → VerifySoftwareToken(AccessToken, UserCode)
 *    then SetUserMFAPreference(AccessToken, ...) to make TOTP the preferred
 *    second factor.
 *
 * This is a protected endpoint — the JWT authorizer validates the token first.
 *
 * Requirements: NFR-2 (operator TOTP MFA)
 */

import middy from '@middy/core';
import { injectLambdaContext } from '@aws-lambda-powertools/logger/middleware';
import { captureLambdaHandler } from '@aws-lambda-powertools/tracer/middleware';
import { logMetrics } from '@aws-lambda-powertools/metrics/middleware';
import type { APIGatewayProxyEventV2, APIGatewayProxyResultV2 } from 'aws-lambda';
import {
  AssociateSoftwareTokenCommand,
  VerifySoftwareTokenCommand,
  SetUserMFAPreferenceCommand,
  InvalidParameterException,
  NotAuthorizedException,
  EnableSoftwareTokenMFAException,
  CodeMismatchException,
} from '@aws-sdk/client-cognito-identity-provider';

import { getCognitoClient } from '../utils/cognito-client';
import { logger, tracer, metrics } from '../../shared/middleware/powertools';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface MfaSetupEvent extends APIGatewayProxyEventV2 {
  body:
    | {
        verificationCode?: string;
      }
    | null;
}

// ---------------------------------------------------------------------------
// Handler
// ---------------------------------------------------------------------------

/**
 * Core MFA setup handler logic.
 *
 * Two flows based on request body content:
 * - No body or empty body: associate a new TOTP software token (returns secretCode)
 * - Body with verificationCode: verify the TOTP code and enable MFA
 */
async function baseHandler(event: MfaSetupEvent): Promise<APIGatewayProxyResultV2> {
  // Both steps act on the caller's own session via the access token.
  const authHeader = event.headers?.['authorization'] ?? event.headers?.['Authorization'];
  const accessToken = authHeader?.replace(/^Bearer\s+/i, '');

  if (!accessToken) {
    logger.error('No access token found in Authorization header');
    return {
      statusCode: 401,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        error: { code: 'UNAUTHORIZED', message: 'Authentication required' },
      }),
    };
  }

  // Parse the request body — determine which step we're in.
  const body = typeof event.body === 'string' ? JSON.parse(event.body) : event.body;
  const verificationCode = body?.verificationCode;

  const cognitoClient = getCognitoClient();

  // -------------------------------------------------------------------------
  // Step 2: Verify the TOTP code and enable MFA
  // -------------------------------------------------------------------------
  if (verificationCode) {
    return handleVerifyAndEnable(cognitoClient, { accessToken, verificationCode });
  }

  // -------------------------------------------------------------------------
  // Step 1: Associate software token — return the secret for the QR code
  // -------------------------------------------------------------------------
  return handleAssociate(cognitoClient, { accessToken });
}

// ---------------------------------------------------------------------------
// Step 1: Associate Software Token
// ---------------------------------------------------------------------------

interface AssociateParams {
  accessToken: string;
}

async function handleAssociate(
  cognitoClient: ReturnType<typeof getCognitoClient>,
  params: AssociateParams
): Promise<APIGatewayProxyResultV2> {
  const { accessToken } = params;

  try {
    // Associating against the caller's access token binds the new TOTP secret
    // to the signed-in user — no challenge Session is involved for a
    // self-service enrollment.
    const command = new AssociateSoftwareTokenCommand({
      AccessToken: accessToken,
    });

    const response = await cognitoClient.send(command);

    if (!response.SecretCode) {
      logger.error('Cognito did not return a secret code');
      return {
        statusCode: 500,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          error: { code: 'INTERNAL_ERROR', message: 'Failed to generate MFA secret' },
        }),
      };
    }

    logger.info('MFA secret code generated');

    return {
      statusCode: 200,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        secretCode: response.SecretCode,
      }),
    };
  } catch (error) {
    if (error instanceof NotAuthorizedException) {
      logger.warn('Not authorized to associate software token');
      return {
        statusCode: 401,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          error: { code: 'UNAUTHORIZED', message: 'Not authorized to set up MFA' },
        }),
      };
    }

    logger.error('Failed to associate software token', {
      error: error instanceof Error ? error.message : String(error),
    });

    return {
      statusCode: 500,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        error: { code: 'INTERNAL_ERROR', message: 'Failed to initiate MFA setup' },
      }),
    };
  }
}

// ---------------------------------------------------------------------------
// Step 2: Verify Software Token and Enable MFA
// ---------------------------------------------------------------------------

interface VerifyParams {
  accessToken: string;
  verificationCode: string;
}

async function handleVerifyAndEnable(
  cognitoClient: ReturnType<typeof getCognitoClient>,
  params: VerifyParams
): Promise<APIGatewayProxyResultV2> {
  const { accessToken, verificationCode } = params;

  try {
    // Verify the TOTP code against the caller's just-associated token.
    const verifyCommand = new VerifySoftwareTokenCommand({
      AccessToken: accessToken,
      UserCode: verificationCode,
      FriendlyDeviceName: 'MerchOS Authenticator',
    });

    const verifyResponse = await cognitoClient.send(verifyCommand);

    if (verifyResponse.Status !== 'SUCCESS') {
      logger.warn('TOTP verification failed', { status: verifyResponse.Status });
      return {
        statusCode: 400,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          error: { code: 'VERIFICATION_FAILED', message: 'Invalid verification code' },
        }),
      };
    }

    // Make TOTP the preferred second factor for the caller (self-service — no
    // admin privilege required since we act on the user's own access token).
    const mfaPreferenceCommand = new SetUserMFAPreferenceCommand({
      AccessToken: accessToken,
      SoftwareTokenMfaSettings: {
        Enabled: true,
        PreferredMfa: true,
      },
    });

    await cognitoClient.send(mfaPreferenceCommand);

    logger.info('MFA enabled successfully');

    return {
      statusCode: 200,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        success: true,
        mfaEnabled: true,
      }),
    };
  } catch (error) {
    if (error instanceof CodeMismatchException) {
      logger.warn('Invalid TOTP code provided');
      return {
        statusCode: 400,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          error: { code: 'INVALID_CODE', message: 'Invalid verification code' },
        }),
      };
    }

    if (error instanceof EnableSoftwareTokenMFAException) {
      logger.warn('Failed to enable software token MFA');
      return {
        statusCode: 400,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          error: { code: 'MFA_ENABLE_FAILED', message: 'Failed to enable MFA' },
        }),
      };
    }

    if (error instanceof NotAuthorizedException) {
      logger.warn('Not authorized to verify software token');
      return {
        statusCode: 401,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          error: { code: 'UNAUTHORIZED', message: 'Not authorized — please sign in again and restart MFA setup' },
        }),
      };
    }

    if (error instanceof InvalidParameterException) {
      logger.warn('Invalid parameter for MFA verification');
      return {
        statusCode: 400,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          error: { code: 'INVALID_PARAMETER', message: 'Invalid verification code' },
        }),
      };
    }

    logger.error('Unexpected error during MFA verification', {
      error: error instanceof Error ? error.message : String(error),
    });

    return {
      statusCode: 500,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        error: { code: 'INTERNAL_ERROR', message: 'An unexpected error occurred during MFA setup' },
      }),
    };
  }
}

// ---------------------------------------------------------------------------
// Middleware Stack
// ---------------------------------------------------------------------------

export const handler = middy(baseHandler)
  .use(injectLambdaContext(logger, { clearState: true }))
  .use(captureLambdaHandler(tracer))
  .use(logMetrics(metrics, { captureColdStartMetric: true }));
