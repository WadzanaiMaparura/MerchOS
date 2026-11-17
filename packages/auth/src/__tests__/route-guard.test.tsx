import React from 'react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, waitFor } from '@testing-library/react';

const replaceMock = vi.fn();
let pathname = '/billing';
vi.mock('next/navigation', () => ({
  useRouter: () => ({ replace: replaceMock }),
  usePathname: () => pathname,
}));

let authState: { isAuthenticated: boolean; isLoading: boolean; user: { role: string } | null } = {
  isAuthenticated: false,
  isLoading: false,
  user: null,
};
vi.mock('../hooks', () => ({ useAuth: () => authState }));

import { RouteGuard } from '../route-guard';

/** happy-dom does not derive window.location from history.replaceState. */
function setUrl(path: string) {
  (window as unknown as { happyDOM: { setURL: (u: string) => void } }).happyDOM.setURL(
    `http://localhost${path}`,
  );
}

beforeEach(() => {
  vi.clearAllMocks();
  pathname = '/billing';
  authState = { isAuthenticated: false, isLoading: false, user: null };
  setUrl('/billing?checkout=success');
});

describe('RouteGuard return-to', () => {
  it('sends an unauthenticated visitor to /login with the page they were on', async () => {
    render(
      <RouteGuard loginPath="/login">
        <div>secret</div>
      </RouteGuard>,
    );
    await waitFor(() =>
      expect(replaceMock).toHaveBeenCalledWith('/login?next=%2Fbilling%3Fcheckout%3Dsuccess'),
    );
  });

  it('does not redirect while auth state is still loading (session hydration)', async () => {
    authState = { isAuthenticated: false, isLoading: true, user: null };
    render(
      <RouteGuard loginPath="/login">
        <div>secret</div>
      </RouteGuard>,
    );
    await new Promise((r) => setTimeout(r, 20));
    expect(replaceMock).not.toHaveBeenCalled();
  });

  it('renders children and does not redirect for a signed-in user', async () => {
    authState = { isAuthenticated: true, isLoading: false, user: { role: 'Seller' } };
    const { findByText } = render(
      <RouteGuard loginPath="/login">
        <div>secret</div>
      </RouteGuard>,
    );
    expect(await findByText('secret')).toBeTruthy();
    expect(replaceMock).not.toHaveBeenCalled();
  });

  it('uses the bare login path when already on an auth page (no loop)', async () => {
    pathname = '/login';
    setUrl('/login');
    render(
      <RouteGuard loginPath="/login">
        <div>secret</div>
      </RouteGuard>,
    );
    await waitFor(() => expect(replaceMock).toHaveBeenCalledWith('/login'));
  });
});
