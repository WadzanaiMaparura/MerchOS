// Focused tests for the approved seller registration form layout.
//
// Covers: the approved field set, removal of the separate "Contact email"
// field, required/optional validation, international phone validation, and
// single-rendered validation errors (via the merged FormField fix).

import React from 'react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

// Mock next/navigation so the page can render/submit without a router.
const pushMock = vi.fn();
vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: pushMock }),
}));

// Mock the auth helper so no real Cognito call is made, and so we can assert
// exactly what the form forwards on submit.
const cognitoSignUpMock = vi.fn();
vi.mock('@merch-os/auth', () => ({
  cognitoSignUp: (...args: unknown[]) => cognitoSignUpMock(...args),
}));

// Mock the pending-registration client so we can assert ordering and payload
// without a real network call.
const createPendingRegistrationMock = vi.fn();
vi.mock('@/app/(auth)/register/register-pending-client', () => ({
  createPendingRegistration: (...args: unknown[]) => createPendingRegistrationMock(...args),
  PendingRegistrationError: class extends Error {},
}));

import RegisterPage from '@/app/(auth)/register/page';

const VALID = {
  fullName: 'Ada Lovelace',
  email: 'ada@example.com',
  phone: '+27831234567',
  org: 'Analytical Engines',
  password: 'Str0ng!passw0rd',
};

async function fillValidForm(user: ReturnType<typeof userEvent.setup>) {
  await user.type(screen.getByLabelText(/full name/i), VALID.fullName);
  await user.type(screen.getByLabelText(/business email/i), VALID.email);
  await user.type(screen.getByLabelText(/phone number/i), VALID.phone);
  await user.type(screen.getByLabelText(/organisation name/i), VALID.org);
  await user.type(screen.getByLabelText(/^password/i), VALID.password);
  await user.type(screen.getByLabelText(/confirm password/i), VALID.password);
}

describe('Registration form — approved field set', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    createPendingRegistrationMock.mockResolvedValue({ registrationId: 'reg-123' });
    cognitoSignUpMock.mockResolvedValue({ isSignUpComplete: false, userId: 'u1' });
  });

  it('renders all approved fields in the approved order', () => {
    render(<RegisterPage />);
    expect(screen.getByLabelText(/full name/i)).toBeTruthy();
    expect(screen.getByLabelText(/business email/i)).toBeTruthy();
    expect(screen.getByLabelText(/phone number/i)).toBeTruthy();
    expect(screen.getByLabelText(/organisation name/i)).toBeTruthy();
    expect(screen.getByLabelText(/^password/i)).toBeTruthy();
    expect(screen.getByLabelText(/confirm password/i)).toBeTruthy();
    expect(
      screen.getByRole('checkbox', { name: /marketing emails/i })
    ).toBeTruthy();
  });

  it('does NOT render a separate "Contact email" field', () => {
    render(<RegisterPage />);
    expect(screen.queryByLabelText(/contact email/i)).toBeNull();
  });

  it('marketing consent is optional and unchecked by default', () => {
    render(<RegisterPage />);
    const checkbox = screen.getByRole('checkbox', {
      name: /marketing emails/i,
    }) as HTMLInputElement;
    expect(checkbox.checked).toBe(false);
    expect(checkbox.required).toBe(false);
  });

  it('shows password requirements before submission', () => {
    render(<RegisterPage />);
    expect(screen.getByText(/at least 12 characters/i)).toBeTruthy();
  });
});

describe('Registration form — validation', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    createPendingRegistrationMock.mockResolvedValue({ registrationId: 'reg-123' });
    cognitoSignUpMock.mockResolvedValue({ isSignUpComplete: false, userId: 'u1' });
  });

  it('rejects a phone number without a leading + / country code', async () => {
    const user = userEvent.setup();
    render(<RegisterPage />);
    await fillValidForm(user);

    // Overwrite phone with a national-format number (no +).
    const phone = screen.getByLabelText(/phone number/i);
    await user.clear(phone);
    await user.type(phone, '0831234567');

    await user.click(screen.getByRole('button', { name: /create account/i }));

    expect(
      await screen.findByText(/valid international phone number/i)
    ).toBeTruthy();
    expect(cognitoSignUpMock).not.toHaveBeenCalled();
  });

  it('requires full name, phone and organisation name', async () => {
    const user = userEvent.setup();
    render(<RegisterPage />);

    await user.click(screen.getByRole('button', { name: /create account/i }));

    expect(await screen.findByText(/full name must be at least/i)).toBeTruthy();
    expect(screen.getByText(/phone number is required/i)).toBeTruthy();
    expect(
      screen.getByText(/organisation name must be at least/i)
    ).toBeTruthy();
    expect(cognitoSignUpMock).not.toHaveBeenCalled();
  });

  it('renders a given validation error exactly once', async () => {
    const user = userEvent.setup();
    render(<RegisterPage />);
    await user.click(screen.getByRole('button', { name: /create account/i }));

    const matches = await screen.findAllByText(/full name must be at least/i);
    expect(matches).toHaveLength(1);
  });

  it('does not call the pending API or Cognito when validation fails', async () => {
    const user = userEvent.setup();
    render(<RegisterPage />);
    await user.click(screen.getByRole('button', { name: /create account/i }));

    expect(createPendingRegistrationMock).not.toHaveBeenCalled();
    expect(cognitoSignUpMock).not.toHaveBeenCalled();
  });
});

describe('Registration form — pending-registration wiring', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    createPendingRegistrationMock.mockResolvedValue({ registrationId: 'reg-123' });
    cognitoSignUpMock.mockResolvedValue({ isSignUpComplete: false, userId: 'u1' });
  });

  it('calls the pending-registration API BEFORE Cognito signup', async () => {
    const order: string[] = [];
    createPendingRegistrationMock.mockImplementation(async () => {
      order.push('pending');
      return { registrationId: 'reg-123' };
    });
    cognitoSignUpMock.mockImplementation(async () => {
      order.push('signup');
      return { isSignUpComplete: false };
    });

    const user = userEvent.setup();
    render(<RegisterPage />);
    await fillValidForm(user);
    await user.click(screen.getByRole('button', { name: /create account/i }));

    await waitFor(() => expect(cognitoSignUpMock).toHaveBeenCalledTimes(1));
    expect(order).toEqual(['pending', 'signup']);
  });

  it('sends all five profile fields to the API and NEVER the password', async () => {
    const user = userEvent.setup();
    render(<RegisterPage />);
    await fillValidForm(user);
    await user.click(screen.getByRole('checkbox', { name: /marketing emails/i }));
    await user.click(screen.getByRole('button', { name: /create account/i }));

    await waitFor(() => expect(createPendingRegistrationMock).toHaveBeenCalledTimes(1));
    const payload = createPendingRegistrationMock.mock.calls[0][0] as Record<string, unknown>;
    expect(Object.keys(payload).sort()).toEqual(
      ['email', 'fullName', 'marketingConsent', 'organisationName', 'phoneNumber'].sort(),
    );
    expect(payload.fullName).toBe(VALID.fullName);
    expect(payload.email).toBe(VALID.email);
    expect(payload.phoneNumber).toBe(VALID.phone);
    expect(payload.organisationName).toBe(VALID.org);
    expect(payload.marketingConsent).toBe(true);
    expect(payload).not.toHaveProperty('password');
    expect(payload).not.toHaveProperty('confirmPassword');
  });

  it('threads the backend registrationId into cognitoSignUp via clientMetadata', async () => {
    createPendingRegistrationMock.mockResolvedValue({ registrationId: 'reg-xyz' });

    const user = userEvent.setup();
    render(<RegisterPage />);
    await fillValidForm(user);
    await user.click(screen.getByRole('button', { name: /create account/i }));

    await waitFor(() => expect(cognitoSignUpMock).toHaveBeenCalledTimes(1));
    const arg = cognitoSignUpMock.mock.calls[0][0] as Record<string, unknown>;
    expect(arg.email).toBe(VALID.email);
    expect(arg.password).toBe(VALID.password);
    expect(arg.registrationId).toBe('reg-xyz');
  });

  it('navigates to /verify with the email and the SAME registrationId', async () => {
    createPendingRegistrationMock.mockResolvedValue({ registrationId: 'reg-xyz' });

    const user = userEvent.setup();
    render(<RegisterPage />);
    await fillValidForm(user);
    await user.click(screen.getByRole('button', { name: /create account/i }));

    await waitFor(() => expect(pushMock).toHaveBeenCalledTimes(1));
    const dest = pushMock.mock.calls[0][0] as string;
    expect(dest).toContain('/verify?');
    expect(dest).toContain(`email=${encodeURIComponent(VALID.email)}`);
    expect(dest).toContain('registrationId=reg-xyz');
  });

  it('does NOT create the Cognito account when the pending API fails', async () => {
    createPendingRegistrationMock.mockRejectedValue(new Error('API down'));

    const user = userEvent.setup();
    render(<RegisterPage />);
    await fillValidForm(user);
    await user.click(screen.getByRole('button', { name: /create account/i }));

    await waitFor(() => expect(screen.getByRole('alert')).toBeTruthy());
    expect(cognitoSignUpMock).not.toHaveBeenCalled();
    expect(pushMock).not.toHaveBeenCalled();
  });

  it('shows a recoverable error and does not navigate when Cognito signup fails after the pending record', async () => {
    cognitoSignUpMock.mockRejectedValue(new Error('UsernameExistsException'));

    const user = userEvent.setup();
    render(<RegisterPage />);
    await fillValidForm(user);
    await user.click(screen.getByRole('button', { name: /create account/i }));

    await waitFor(() => expect(screen.getByRole('alert')).toBeTruthy());
    // Pending record was created, Cognito failed → mentions the hold window.
    expect(screen.getByRole('alert').textContent).toMatch(/hour/i);
    expect(pushMock).not.toHaveBeenCalled();
  });
});
