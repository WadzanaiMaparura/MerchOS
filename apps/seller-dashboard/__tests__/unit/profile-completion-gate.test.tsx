// Validates: Stage 1 registration-recovery routing (ProfileCompletionGate)

import React from 'react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';

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
});
