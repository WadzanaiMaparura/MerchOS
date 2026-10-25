/**
 * Component tests for the admin Users page.
 *
 * Verifies the tenant-scoped user-management flow: tenant selection gates the
 * table, users render, role change / disable / delete call the right mutations
 * with the right payloads, and owner deletion is blocked in the UI.
 *
 * The api-client hooks and auth/role hooks are mocked so the test exercises the
 * page's wiring and UX, not the network or the route guard internals. The UI
 * `Select` is stubbed with a native <select> (the real one is a Radix portal
 * component that isn't driveable with fireEvent in jsdom).
 */

import React from 'react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';

// ─── Mocks ─────────────────────────────────────────────────────────────────

const toastMock = vi.fn();

vi.mock('@merch-os/ui', async () => {
  const actual = await vi.importActual<typeof import('@merch-os/ui')>('@merch-os/ui');
  return {
    ...actual,
    useToast: () => ({ toast: toastMock, dismiss: vi.fn() }),
    // Native-select stub so tests can drive selection with fireEvent.change.
    Select: ({
      id,
      label,
      value,
      onValueChange,
      options,
    }: {
      id?: string;
      label: string;
      value?: string;
      onValueChange?: (v: string) => void;
      options: Array<{ value: string; label: string }>;
    }) => (
      <select
        id={id}
        aria-label={label || id}
        value={value}
        onChange={(e) => onValueChange?.(e.target.value)}
      >
        {options.map((o) => (
          <option key={o.value} value={o.value}>
            {o.label}
          </option>
        ))}
      </select>
    ),
  };
});

vi.mock('../../hooks/useAdminAuth', () => ({
  useAdminAuth: () => ({ isAuthenticated: true, isLoading: false, accessToken: 'tok' }),
}));
vi.mock('../../hooks/usePlatformRole', () => ({
  usePlatformRole: () => ({ platformRole: 'Admin', isResolved: true }),
}));
vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: vi.fn(), replace: vi.fn() }),
  usePathname: () => '/users',
}));

const updateRoleMutate = vi.fn();
const disableMutate = vi.fn();
const deleteMutate = vi.fn();
const inviteMutate = vi.fn();

let mockUsers: Array<Record<string, unknown>> = [];
let mockUsersState = { isLoading: false, isError: false };

vi.mock('@merch-os/api-client', () => ({
  useAdminTenants: () => ({
    data: { items: [{ tenantId: 't-1', name: 'Acme Co' }], total: 1 },
    isLoading: false,
  }),
  useAdminUsers: () => ({
    data: { users: mockUsers },
    isLoading: mockUsersState.isLoading,
    isError: mockUsersState.isError,
    error: undefined,
    refetch: vi.fn(),
  }),
  useUpdateUserRole: () => ({ mutateAsync: updateRoleMutate, isPending: false }),
  useDisableUser: () => ({ mutateAsync: disableMutate, isPending: false }),
  useDeleteUser: () => ({ mutateAsync: deleteMutate, isPending: false }),
  useInviteUser: () => ({ mutateAsync: inviteMutate, isPending: false }),
}));

import UsersPage from '../../app/(dashboard)/users/page';

const USER_EDITOR = {
  userId: 'u-1',
  email: 'editor@acme.co',
  role: 'editor',
  tenantId: 't-1',
  status: 'CONFIRMED',
  createdAt: '2026-01-01T00:00:00.000Z',
};
const USER_OWNER = {
  userId: 'u-2',
  email: 'owner@acme.co',
  role: 'owner',
  tenantId: 't-1',
  status: 'CONFIRMED',
  createdAt: '2026-01-01T00:00:00.000Z',
};

function selectTenant() {
  fireEvent.change(screen.getByLabelText('Tenant'), { target: { value: 't-1' } });
}

beforeEach(() => {
  vi.clearAllMocks();
  mockUsers = [];
  mockUsersState = { isLoading: false, isError: false };
});

describe('Users page — tenant gating', () => {
  it('prompts to select a tenant before showing the table', () => {
    render(<UsersPage />);
    expect(screen.getByText(/select a tenant to view and manage/i)).toBeInTheDocument();
  });

  it('disables the Invite button until a tenant is selected', () => {
    render(<UsersPage />);
    expect(screen.getByRole('button', { name: /invite user/i })).toBeDisabled();
  });
});

describe('Users page — user actions', () => {
  it('renders users once a tenant is selected', async () => {
    mockUsers = [USER_EDITOR];
    render(<UsersPage />);
    selectTenant();
    await waitFor(() => expect(screen.getByText('editor@acme.co')).toBeInTheDocument());
  });

  it('calls updateUserRole with the right payload on role change', async () => {
    mockUsers = [USER_EDITOR];
    updateRoleMutate.mockResolvedValue({ userId: 'u-1', role: 'admin', updatedAt: 'now' });
    render(<UsersPage />);
    selectTenant();
    await waitFor(() => expect(screen.getByText('editor@acme.co')).toBeInTheDocument());

    fireEvent.change(screen.getByLabelText('role-u-1'), { target: { value: 'admin' } });

    await waitFor(() =>
      expect(updateRoleMutate).toHaveBeenCalledWith({ tenantId: 't-1', userId: 'u-1', role: 'admin' })
    );
  });

  it('disables the Delete button for an owner', async () => {
    mockUsers = [USER_OWNER];
    render(<UsersPage />);
    selectTenant();
    await waitFor(() => expect(screen.getByText('owner@acme.co')).toBeInTheDocument());
    expect(screen.getByRole('button', { name: /^delete$/i })).toBeDisabled();
  });

  it('opens a confirmation and calls disableUser on confirm', async () => {
    mockUsers = [USER_EDITOR];
    disableMutate.mockResolvedValue({ success: true, userId: 'u-1', disabled: true });
    render(<UsersPage />);
    selectTenant();
    await waitFor(() => expect(screen.getByText('editor@acme.co')).toBeInTheDocument());

    fireEvent.click(screen.getByRole('button', { name: /^disable$/i }));
    await waitFor(() =>
      expect(screen.getAllByText(/will be blocked from signing in/i).length).toBeGreaterThan(0)
    );
    const confirmBtns = screen.getAllByRole('button', { name: /^disable$/i });
    fireEvent.click(confirmBtns[confirmBtns.length - 1]!);

    await waitFor(() =>
      expect(disableMutate).toHaveBeenCalledWith({ tenantId: 't-1', userId: 'u-1' })
    );
  });

  it('calls deleteUser on confirm for a non-owner', async () => {
    mockUsers = [USER_EDITOR];
    deleteMutate.mockResolvedValue({ success: true, userId: 'u-1' });
    render(<UsersPage />);
    selectTenant();
    await waitFor(() => expect(screen.getByText('editor@acme.co')).toBeInTheDocument());

    fireEvent.click(screen.getByRole('button', { name: /^delete$/i }));
    await waitFor(() =>
      expect(screen.getAllByText(/permanently removed/i).length).toBeGreaterThan(0)
    );
    const confirmBtns = screen.getAllByRole('button', { name: /^delete$/i });
    fireEvent.click(confirmBtns[confirmBtns.length - 1]!);

    await waitFor(() =>
      expect(deleteMutate).toHaveBeenCalledWith({ tenantId: 't-1', userId: 'u-1' })
    );
  });
});
