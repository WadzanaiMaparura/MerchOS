import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import {
  createPendingRegistration,
  PendingRegistrationError,
} from '@/app/(auth)/register/register-pending-client';

const INPUT = {
  fullName: 'Ada Lovelace',
  email: 'ada@example.com',
  phoneNumber: '+27831234567',
  organisationName: 'Analytical Engines',
  marketingConsent: true,
};

function jsonResponse(body: unknown, ok = true, status = 200): Response {
  return {
    ok,
    status,
    json: async () => body,
  } as unknown as Response;
}

describe('createPendingRegistration', () => {
  beforeEach(() => {
    process.env['NEXT_PUBLIC_API_URL'] = 'https://api.example.test';
  });
  afterEach(() => {
    delete process.env['NEXT_PUBLIC_API_URL'];
  });

  it('POSTs only the five profile fields (never the password)', async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse({ registrationId: 'reg-1' }));

    const result = await createPendingRegistration(INPUT, fetchMock as unknown as typeof fetch);

    expect(result.registrationId).toBe('reg-1');
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe('https://api.example.test/auth/register-pending');
    expect(init.method).toBe('POST');
    const sent = JSON.parse(init.body);
    expect(Object.keys(sent).sort()).toEqual(
      ['email', 'fullName', 'marketingConsent', 'organisationName', 'phoneNumber'].sort(),
    );
    expect(sent).not.toHaveProperty('password');
    expect(sent).not.toHaveProperty('code');
  });

  it('throws when NEXT_PUBLIC_API_URL is not configured', async () => {
    delete process.env['NEXT_PUBLIC_API_URL'];
    const fetchMock = vi.fn();
    await expect(
      createPendingRegistration(INPUT, fetchMock as unknown as typeof fetch),
    ).rejects.toBeInstanceOf(PendingRegistrationError);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('throws on a non-OK response', async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse({}, false, 500));
    await expect(
      createPendingRegistration(INPUT, fetchMock as unknown as typeof fetch),
    ).rejects.toBeInstanceOf(PendingRegistrationError);
  });

  it('throws on a network/CORS failure', async () => {
    const fetchMock = vi.fn().mockRejectedValue(new TypeError('Failed to fetch'));
    await expect(
      createPendingRegistration(INPUT, fetchMock as unknown as typeof fetch),
    ).rejects.toBeInstanceOf(PendingRegistrationError);
  });

  it('throws when the response lacks a non-empty registrationId', async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse({ registrationId: '' }));
    await expect(
      createPendingRegistration(INPUT, fetchMock as unknown as typeof fetch),
    ).rejects.toBeInstanceOf(PendingRegistrationError);

    const fetchMock2 = vi.fn().mockResolvedValue(jsonResponse({}));
    await expect(
      createPendingRegistration(INPUT, fetchMock2 as unknown as typeof fetch),
    ).rejects.toBeInstanceOf(PendingRegistrationError);
  });
});
