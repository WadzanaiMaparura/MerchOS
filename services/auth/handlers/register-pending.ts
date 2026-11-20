/**
 * Register-Pending Lambda handler for POST /auth/register-pending.
 *
 * Unauthenticated endpoint. Called by the seller registration form BEFORE the
 * Cognito account is created, to persist the approved business-profile details
 * (full name, business email, international phone, organisation name, optional
 * marketing consent) under a short-lived, server-owned pending-registration
 * record.
 *
 * Server generates both the opaque registrationId and the tenantId. The
 * password, password confirmation and verification code are never accepted or
 * stored here. The response returns only the registrationId.
 *
 * This endpoint does NOT trust any client-supplied tenantId or role.
 */

import middy from '@middy/core';
import type { APIGatewayProxyEventV2, APIGatewayProxyResultV2 } from 'aws-lambda';

import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { DynamoDBDocumentClient } from '@aws-sdk/lib-dynamodb';

import { registerPendingSchema } from '../schemas';
import { PendingRegistrationRepository } from '../registration/pending-registration-repository';
import { ACCOUNT_EXISTS_MESSAGE, findTakenClaims } from '../registration/identity-claims';
import { inputValidationMiddleware } from '../../shared/middleware/input-validation';
import { logger } from '../../shared/middleware/powertools';

interface RegisterPendingEvent extends Omit<APIGatewayProxyEventV2, 'body'> {
  body: {
    fullName: string;
    email: string;
    phoneNumber: string;
    organisationName: string;
    marketingConsent?: boolean;
  };
}

let claimsClient: DynamoDBDocumentClient | undefined;
/** Test seam for the identity-claim lookup. */
export function setClaimsClient(client: DynamoDBDocumentClient | undefined): void {
  claimsClient = client;
}
function getClaimsClient(): DynamoDBDocumentClient {
  return (claimsClient ??= DynamoDBDocumentClient.from(
    new DynamoDBClient({ region: process.env['AWS_REGION'] ?? 'eu-west-1' }),
  ));
}

async function baseHandler(
  event: RegisterPendingEvent
): Promise<APIGatewayProxyResultV2> {
  const tenantsTable = process.env['TENANTS_TABLE'];
  if (!tenantsTable) {
    logger.error('Missing TENANTS_TABLE environment variable');
    return {
      statusCode: 500,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        error: { code: 'INTERNAL_ERROR', message: 'Service misconfigured' },
      }),
    };
  }

  const { fullName, email, phoneNumber, organisationName, marketingConsent } =
    event.body;

  try {
    // One free trial per seller: refuse BEFORE a Cognito account exists if the
    // email, phone or business name already belongs to an account.
    const taken = await findTakenClaims(getClaimsClient(), tenantsTable, {
      email,
      phoneNumber,
      organisationName,
    });
    if (taken.length > 0) {
      // Kinds only (no PII) so abuse attempts are visible in the logs.
      logger.warn('Registration refused: identity already claimed', { kinds: taken });
      return {
        statusCode: 409,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          error: { code: 'ACCOUNT_ALREADY_EXISTS', message: ACCOUNT_EXISTS_MESSAGE },
        }),
      };
    }

    const repository = new PendingRegistrationRepository({
      tableName: tenantsTable,
    });

    const { registrationId } = await repository.create({
      fullName,
      email,
      phoneNumber,
      organisationName,
      marketingConsent: marketingConsent ?? false,
    });

    // Do NOT log the registrationId at info level alongside PII; keep the
    // response minimal and free of internal keys (tenantId is not returned).
    logger.info('Pending registration created');

    return {
      statusCode: 201,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ registrationId }),
    };
  } catch (error) {
    logger.error('Failed to create pending registration', {
      error: error instanceof Error ? error.message : String(error),
    });
    return {
      statusCode: 500,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        error: { code: 'INTERNAL_ERROR', message: 'An unexpected error occurred' },
      }),
    };
  }
}

export const handler = middy(baseHandler).use(
  inputValidationMiddleware({
    schema: registerPendingSchema,
    source: 'body',
  })
);
