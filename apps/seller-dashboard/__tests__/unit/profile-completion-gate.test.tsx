// Validates: Stage 1 registration-recovery routing (ProfileCompletionGate)

import React from 'react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

const replace = vi.fn();
vi.mock('next/navigation', () => ({
  useRouter: () => ({ replace, push: vi.fn() }),
  usePathname: () => '/dashboard',
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

describe('ProfileCompletionGate', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('redirects a self-registration owner with incomplete profile to /complete-profile', async () => {
    getProfileStatus.mockResolvedValue('needs_profile_completion');
    render(
      <ProfileCompletionGate>
        <div>app content</div>
      </ProfileCompletionGate>,
    );
    await waitFor(() => expect(replace).toHaveBeenCalledWith('/complete-profile'));
  });

  it('does NOT redirect an invited user into owner creation', async () => {
    getProfileStatus.mockResolvedValue('invited');
    render(
      <ProfileCompletionGate>
        <div>app content</div>
      </ProfileCompletionGate>,
    );
    await waitFor(() => expect(getProfileStatus).toHaveBeenCalled());
    expect(replace).not.toHaveBeenCalled();
    expect(screen.getByText('app content')).toBeTruthy();
  });

  it('does NOT redirect a complete user', async () => {
    getProfileStatus.mockResolvedValue('complete');
    render(
      <ProfileCompletionGate>
        <div>app content</div>
      </ProfileCompletionGate>,
    );
    await waitFor(() => expect(getProfileStatus).toHaveBeenCalled());
    expect(replace).not.toHaveBeenCalled();
  });

  it('on API failure renders children + a retry control and does not redirect', async () => {
    getProfileStatus.mockRejectedValue(new Error('503'));
    render(
      <ProfileCompletionGate>
        <div>app content</div>
      </ProfileCompletionGate>,
    );
    await waitFor(() => expect(screen.getByRole('button', { name: /retry/i })).toBeTruthy());
    expect(replace).not.toHaveBeenCalled();
    expect(screen.getByText('app content')).toBeTruthy();
  });

  // Finding 4: a stale redirect flag must not block a necessary re-redirect.
  // While the status check keeps failing the retry control is shown and no
  // redirect occurs; once a retry evaluation resolves to an incomplete profile,
  // the gate must still route to /complete-profile (the flag is reset per run).
  it('re-evaluates and redirects on retry when the profile is still incomplete', async () => {
    let failing = true;
    getProfileStatus.mockImplementation(async () => {
      if (failing) throw new Error('503');
      return 'needs_profile_completion';
    });

    render(
      <ProfileCompletionGate>
        <div>app content</div>
      </ProfileCompletionGate>,
    );

    // While failing: retry control shown, no redirect yet.
    const retry = await screen.findByRole('button', { name: /retry/i });
    expect(replace).not.toHaveBeenCalled();

    // Flip to an incomplete-but-resolvable status, then retry → must redirect.
    failing = false;
    await userEvent.click(retry);
    await waitFor(() => expect(replace).toHaveBeenCalledWith('/complete-profile'));
  });
});
