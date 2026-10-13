// Validates PR#25 findings 2 (no implicit marketing consent) and 4 (status-aware
// post-submission navigation) for the profile-completion recovery screen.

import React from 'react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

const replace = vi.fn();
vi.mock('next/navigation', () => ({
  useRouter: () => ({ replace, push: vi.fn() }),
}));

const refreshSession = vi.fn().mockResolvedValue('token-abc');
vi.mock('@merch-os/auth', () => ({
  useAuth: () => ({ refreshSession }),
}));

const completeProfile = vi.fn();
const getProfileStatus = vi.fn();
vi.mock('@/app/(dashboard)/lib/profile-api', () => ({
  completeProfile: (...a: unknown[]) => completeProfile(...a),
  getProfileStatus: (...a: unknown[]) => getProfileStatus(...a),
}));

import CompleteProfilePage from '@/app/(dashboard)/complete-profile/page';

async function fillValidForm(user: ReturnType<typeof userEvent.setup>) {
  await user.type(screen.getByLabelText(/full name/i), 'Owner One');
  await user.type(screen.getByLabelText(/phone number/i), '+27 71 234 5678');
  await user.type(screen.getByLabelText(/organisation name/i), 'Acme Trading');
}

describe('CompleteProfilePage', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    completeProfile.mockResolvedValue(undefined);
    getProfileStatus.mockResolvedValue('complete');
  });

  it('does NOT render any marketing-consent controls (finding 2)', () => {
    render(<CompleteProfilePage />);
    expect(screen.queryByText(/marketing/i)).toBeNull();
    expect(screen.queryByText(/receive marketing communications/i)).toBeNull();
  });

  it('submits with consentGranted:false and empty channels, and an E.164-normalised phone (finding 2 + 3)', async () => {
    const user = userEvent.setup();
    render(<CompleteProfilePage />);
    await fillValidForm(user);
    await user.click(screen.getByRole('button', { name: /complete setup/i }));

    await waitFor(() => expect(completeProfile).toHaveBeenCalledTimes(1));
    const payload = completeProfile.mock.calls[0][1];
    expect(payload).toMatchObject({
      fullName: 'Owner One',
      organisationName: 'Acme Trading',
      phone: '+27712345678', // normalised to compact E.164
      consentGranted: false,
      consentChannels: [],
    });
  });

  it('navigates to /dashboard only when status is confirmed complete (finding 4)', async () => {
    const user = userEvent.setup();
    getProfileStatus.mockResolvedValue('complete');
    render(<CompleteProfilePage />);
    await fillValidForm(user);
    await user.click(screen.getByRole('button', { name: /complete setup/i }));

    await waitFor(() => expect(replace).toHaveBeenCalledWith('/dashboard'));
  });

  it('shows a recoverable error and does NOT navigate when status stays needs_profile_completion (finding 4)', async () => {
    const user = userEvent.setup();
    getProfileStatus.mockResolvedValue('needs_profile_completion');
    render(<CompleteProfilePage />);
    await fillValidForm(user);
    await user.click(screen.getByRole('button', { name: /complete setup/i }));

    await waitFor(() => expect(screen.getByRole('alert')).toBeTruthy());
    expect(screen.getByRole('alert').textContent).toMatch(/not complete yet/i);
    expect(replace).not.toHaveBeenCalled();
  });

  it('handles a transient status-check failure without advancing (finding 4)', async () => {
    const user = userEvent.setup();
    getProfileStatus.mockRejectedValue(new Error('503'));
    render(<CompleteProfilePage />);
    await fillValidForm(user);
    await user.click(screen.getByRole('button', { name: /complete setup/i }));

    await waitFor(() => expect(screen.getByRole('alert')).toBeTruthy());
    expect(screen.getByRole('alert').textContent).toMatch(/could not confirm/i);
    expect(replace).not.toHaveBeenCalled();
    // The write was attempted exactly once; we did not proceed on an unconfirmed state.
    expect(completeProfile).toHaveBeenCalledTimes(1);
  });

  it('rejects an invalid (country-code-less) phone before any submission (finding 3)', async () => {
    const user = userEvent.setup();
    render(<CompleteProfilePage />);
    await user.type(screen.getByLabelText(/full name/i), 'Owner One');
    await user.type(screen.getByLabelText(/phone number/i), '0712345678');
    await user.type(screen.getByLabelText(/organisation name/i), 'Acme Trading');
    await user.click(screen.getByRole('button', { name: /complete setup/i }));

    await waitFor(() =>
      expect(screen.getByText(/valid international phone number/i)).toBeTruthy(),
    );
    expect(completeProfile).not.toHaveBeenCalled();
    expect(replace).not.toHaveBeenCalled();
  });
});
