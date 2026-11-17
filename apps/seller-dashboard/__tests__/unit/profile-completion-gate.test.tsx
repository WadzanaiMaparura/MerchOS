// Validates: registration-recovery routing + initial-load behaviour (ProfileCompletionGate)

import React from 'react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

const replace = vi.fn();
// Mutable pathname so individual tests can exercise the /complete-profile exemption.
let currentPathname = '/dashboard';
vi.mock('next/navigation', () => ({
  useRouter: () => ({ replace, push: vi.fn() }),
  usePathname: () => currentPathname,
}));

const refreshSession = vi.fn().mockResolvedValue('token-abc');
vi.mock('@merch-os/auth', () => ({
  useAuth: () => ({ user: { userId: 's1', email: 'a@b.com' }, isLoading: false, refreshSession }),
}));

const getProfileStatus = vi.fn();
vi.mock('@/app/(dashboard)/lib/profile-api', () => ({
  getProfileStatus: (...a: unknown[]) => getProfileStatus(...a),
}));

import { ProfileCompletionGate } from '@/app/(dashboard)/components/ProfileCompletionGate';

function renderGate() {
  return render(
    <ProfileCompletionGate>
      <div>app content</div>
    </ProfileCompletionGate>,
  );
}

describe('ProfileCompletionGate', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    currentPathname = '/dashboard';
  });

  it('withholds dashboard children while the initial status check is pending', async () => {
    // A status request that never resolves keeps the gate in its initial state.
    getProfileStatus.mockReturnValue(new Promise(() => {}));
    renderGate();

    // Loading state shown; children NOT yet rendered.
    expect(screen.getByRole('status')).toBeTruthy();
    expect(screen.queryByText('app content')).toBeNull();
    expect(replace).not.toHaveBeenCalled();
  });

  it('renders children after a complete result', async () => {
    getProfileStatus.mockResolvedValue('complete');
    renderGate();
    await waitFor(() => expect(screen.getByText('app content')).toBeTruthy());
    expect(replace).not.toHaveBeenCalled();
  });

  it('redirects an incomplete owner WITHOUT exposing dashboard children first', async () => {
    getProfileStatus.mockResolvedValue('needs_profile_completion');
    renderGate();

    await waitFor(() => expect(replace).toHaveBeenCalledWith('/complete-profile'));
    // Children must never have been rendered during the redirect.
    expect(screen.queryByText('app content')).toBeNull();
  });

  it('does NOT redirect an invited user into owner creation (renders children)', async () => {
    getProfileStatus.mockResolvedValue('invited');
    renderGate();
    await waitFor(() => expect(screen.getByText('app content')).toBeTruthy());
    expect(replace).not.toHaveBeenCalled();
  });

  it.each(['not_verified', 'conflict'] as const)(
    'does NOT redirect the %s state (renders children)',
    async (status) => {
      getProfileStatus.mockResolvedValue(status);
      renderGate();
      await waitFor(() => expect(screen.getByText('app content')).toBeTruthy());
      expect(getProfileStatus).toHaveBeenCalled();
      expect(replace).not.toHaveBeenCalled();
    },
  );

  it('on initial API failure fails open: renders children, no warning banner, no redirect', async () => {
    getProfileStatus.mockRejectedValue(new Error('503'));
    renderGate();
    await waitFor(() => expect(screen.getByText('app content')).toBeTruthy());
    expect(getProfileStatus).toHaveBeenCalled();
    // The warning/retry banner was intentionally removed (see gate source note).
    expect(screen.queryByRole('button', { name: /retry/i })).toBeNull();
    expect(replace).not.toHaveBeenCalled();
  });

  it('exempts the /complete-profile route from the gate (renders children, no status check, no redirect)', async () => {
    currentPathname = '/complete-profile';
    getProfileStatus.mockResolvedValue('needs_profile_completion');
    renderGate();

    await waitFor(() => expect(screen.getByText('app content')).toBeTruthy());
    expect(getProfileStatus).not.toHaveBeenCalled();
    expect(replace).not.toHaveBeenCalled();
  });
});
