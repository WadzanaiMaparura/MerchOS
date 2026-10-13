/**
 * Thin client for the authenticated registration-recovery endpoints
 * (GET /auth/profile-status, POST /auth/complete-profile).
 *
 * Uses the Cognito access token (obtained via the AuthProvider's refreshSession)
 * as a Bearer credential, mirroring the WebSocket/REST pattern used elsewhere
 * in the dashboard. The base URL comes from NEXT_PUBLIC_API_URL.
 */

export type ProfileStatusState =
  | 'complete'
  | 'needs_profile_completion'
  | 'invited'
  | 'not_verified'
  | 'conflict';

export interface CompleteProfilePayload {
  fullName: string;
  phone: string;
  organisationName: string;
  consentGranted: boolean;
  consentChannels: Array<'email' | 'sms'>;
}

function authApiBase(): string {
  // NEXT_PUBLIC_API_URL is the Auth API base (e.g. https://xxxx.execute-api...).
  const base = process.env.NEXT_PUBLIC_API_URL;
  if (!base) {
    throw new Error('NEXT_PUBLIC_API_URL is not configured');
  }
  return base.replace(/\/$/, '');
}

/**
 * Fetch the current user's profile-completion status.
 * @param getAccessToken resolves the current Cognito access token
 */
export async function getProfileStatus(
  getAccessToken: () => Promise<string>,
): Promise<ProfileStatusState> {
  const token = await getAccessToken();
  const res = await fetch(`${authApiBase()}/auth/profile-status`, {
    method: 'GET',
    headers: { Authorization: `Bearer ${token}` },
  });

  if (!res.ok) {
    throw new Error(`profile-status request failed: ${res.status}`);
  }

  const data = (await res.json()) as { status: ProfileStatusState };
  return data.status;
}

/**
 * Submit the owner profile-completion payload. Returns true on success.
 */
export async function completeProfile(
  getAccessToken: () => Promise<string>,
  payload: CompleteProfilePayload,
): Promise<void> {
  const token = await getAccessToken();
  const res = await fetch(`${authApiBase()}/auth/complete-profile`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(payload),
  });

  if (!res.ok) {
    let code = 'REQUEST_FAILED';
    try {
      const body = (await res.json()) as { error?: { code?: string } };
      code = body.error?.code ?? code;
    } catch {
      // ignore parse errors; use default code
    }
    throw new Error(code);
  }
}
