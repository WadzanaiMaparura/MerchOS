/**
 * Client for the pending-registration backend (POST /auth/register-pending).
 *
 * Sends only the business-profile fields (full name, business email,
 * international phone, organisation name, marketing consent). It MUST NOT send
 * the password or any verification code. Returns the opaque server-generated
 * registrationId, which the caller then threads through Cognito signUp /
 * confirmSignUp via clientMetadata.
 */

export interface PendingRegistrationInput {
  fullName: string;
  email: string;
  phoneNumber: string;
  organisationName: string;
  marketingConsent: boolean;
}

export interface PendingRegistrationResult {
  registrationId: string;
}

export class PendingRegistrationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'PendingRegistrationError';
  }
}

/**
 * Creates a pending-registration record and returns its registrationId.
 *
 * Throws PendingRegistrationError when the API base URL is not configured, the
 * request fails, the response is not OK, or the body lacks a non-empty
 * registrationId. Never logs the payload (which contains PII).
 */
export async function createPendingRegistration(
  input: PendingRegistrationInput,
  fetchImpl: typeof fetch = fetch,
): Promise<PendingRegistrationResult> {
  const baseUrl = process.env['NEXT_PUBLIC_API_URL'];
  if (!baseUrl) {
    throw new PendingRegistrationError(
      'Registration service is not configured. Please try again later.',
    );
  }

  let response: Response;
  try {
    response = await fetchImpl(`${baseUrl}/auth/register-pending`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        fullName: input.fullName,
        email: input.email,
        phoneNumber: input.phoneNumber,
        organisationName: input.organisationName,
        marketingConsent: input.marketingConsent,
      }),
    });
  } catch {
    // Network / CORS failure. Do not include the payload in the message.
    throw new PendingRegistrationError(
      'Could not reach the registration service. Please check your connection and try again.',
    );
  }

  if (!response.ok) {
    throw new PendingRegistrationError(
      'Registration could not be started. Please try again.',
    );
  }

  let body: unknown;
  try {
    body = await response.json();
  } catch {
    throw new PendingRegistrationError('Unexpected response from the registration service.');
  }

  const registrationId =
    body && typeof body === 'object'
      ? (body as Record<string, unknown>)['registrationId']
      : undefined;

  if (typeof registrationId !== 'string' || registrationId.trim().length === 0) {
    throw new PendingRegistrationError(
      'Registration could not be started (missing registration id). Please try again.',
    );
  }

  return { registrationId };
}
