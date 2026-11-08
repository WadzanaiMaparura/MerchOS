'use client';

/**
 * UsersPage — Admin user-management for a selected tenant.
 *
 * Wires the Category 2 auth endpoints (ADR-005): list / invite / update-role /
 * disable / delete. Users are tenant-scoped, so the operator first picks a
 * tenant (via useAdminTenants), then manages that tenant's users.
 *
 * Gated with AdminRouteGuard requiredResource="users" — only platform operators
 * with the `users` permission reach it. The backend independently enforces
 * authorization on every call.
 */

import React, { useCallback, useMemo, useState } from 'react';
import { useAdminTenants, useAdminUsers, useUpdateUserRole, useDisableUser, useDeleteUser } from '@merch-os/api-client';
import type { AdminUserSummary } from '@merch-os/api-client';
import type { ApiError } from '@merch-os/api-client';
import type { SellerRole } from '@merch-os/types';
import { DataTable, Badge, Alert, Select, ConfirmationModal, useToast } from '@merch-os/ui';
import type { ColumnDef, BadgeVariant, SelectOption } from '@merch-os/ui';
import { AdminRouteGuard } from '../../../components/AdminRouteGuard';
import { InviteUserModal } from './components/InviteUserModal';

const ROLE_OPTIONS: SelectOption[] = [
  { value: 'viewer', label: 'Viewer' },
  { value: 'editor', label: 'Editor' },
  { value: 'admin', label: 'Admin' },
  { value: 'owner', label: 'Owner' },
];

const ROLE_VARIANT: Record<string, BadgeVariant> = {
  owner: 'default',
  admin: 'warning',
  editor: 'info',
  viewer: 'neutral',
};

const STATUS_VARIANT: Record<string, BadgeVariant> = {
  CONFIRMED: 'success',
  FORCE_CHANGE_PASSWORD: 'warning',
  DISABLED: 'error',
};

function titleCase(s: string): string {
  if (!s) return s;
  return s.charAt(0).toUpperCase() + s.slice(1).toLowerCase();
}

function formatDate(iso: string): string {
  if (!iso) return '—';
  try {
    return new Date(iso).toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' });
  } catch {
    return iso;
  }
}

function UsersPageContent() {
  const { toast } = useToast();

  const [selectedTenantId, setSelectedTenantId] = useState<string>('');
  const [inviteOpen, setInviteOpen] = useState(false);
  const [disableTarget, setDisableTarget] = useState<AdminUserSummary | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<AdminUserSummary | null>(null);

  // Tenant selector options (reuse the existing tenants list).
  const { data: tenantsData, isLoading: tenantsLoading } = useAdminTenants({ page: 1, pageSize: 100 });
  const tenantOptions: SelectOption[] = useMemo(() => {
    const items = tenantsData?.items ?? [];
    return [
      { value: '', label: tenantsLoading ? 'Loading tenants…' : 'Select a tenant…' },
      ...items.map((t) => ({ value: t.tenantId, label: t.name })),
    ];
  }, [tenantsData, tenantsLoading]);

  // Users for the selected tenant.
  const {
    data: usersData,
    isLoading: usersLoading,
    isError: usersError,
    error: usersErrorObj,
    refetch,
  } = useAdminUsers({ tenantId: selectedTenantId, limit: 100 });

  const users = usersData?.users ?? [];

  const updateRole = useUpdateUserRole();
  const disableUser = useDisableUser();
  const deleteUser = useDeleteUser();

  // ── Role change (inline select) ──────────────────────────────────────────
  const handleRoleChange = useCallback(
    async (user: AdminUserSummary, newRole: string) => {
      if (newRole === user.role) return;
      try {
        await updateRole.mutateAsync({
          tenantId: selectedTenantId,
          userId: user.userId,
          role: newRole as SellerRole,
        });
        toast({ variant: 'success', title: 'Role updated', description: `${user.email} is now ${titleCase(newRole)}.` });
      } catch (err) {
        const e = err as ApiError;
        const msg =
          e.code === 'CANNOT_CHANGE_OWN_ROLE'
            ? 'You cannot change your own role.'
            : e.code === 'USER_NOT_FOUND'
              ? 'That user no longer exists.'
              : e.message || 'Failed to update role.';
        toast({ variant: 'error', title: 'Role change failed', description: msg });
      }
    },
    [updateRole, selectedTenantId, toast]
  );

  // ── Disable ────────────────────────────────────────────────────────────────
  const confirmDisable = useCallback(async () => {
    if (!disableTarget) return;
    try {
      await disableUser.mutateAsync({ tenantId: selectedTenantId, userId: disableTarget.userId });
      toast({ variant: 'success', title: 'User disabled', description: `${disableTarget.email} can no longer sign in.` });
      setDisableTarget(null);
    } catch (err) {
      const e = err as ApiError;
      toast({
        variant: 'error',
        title: 'Disable failed',
        description: e.code === 'USER_NOT_FOUND' ? 'That user no longer exists.' : e.message || 'Failed to disable user.',
      });
      setDisableTarget(null);
    }
  }, [disableTarget, disableUser, selectedTenantId, toast]);

  // ── Delete ───────────────────────────────────────────────────────────────
  const confirmDelete = useCallback(async () => {
    if (!deleteTarget) return;
    try {
      await deleteUser.mutateAsync({ tenantId: selectedTenantId, userId: deleteTarget.userId });
      toast({ variant: 'success', title: 'User deleted', description: `${deleteTarget.email} has been removed.` });
      setDeleteTarget(null);
    } catch (err) {
      const e = err as ApiError;
      const msg =
        e.code === 'CANNOT_DELETE_OWNER'
          ? 'Owners cannot be deleted. Change their role first.'
          : e.code === 'USER_NOT_FOUND'
            ? 'That user no longer exists.'
            : e.message || 'Failed to delete user.';
      toast({ variant: 'error', title: 'Delete failed', description: msg });
      setDeleteTarget(null);
    }
  }, [deleteTarget, deleteUser, selectedTenantId, toast]);

  const columns: ColumnDef<AdminUserSummary>[] = useMemo(
    () => [
      {
        id: 'email',
        header: 'Email',
        cell: (row) => <span className="font-medium text-gray-900">{row.email}</span>,
        width: 'w-64',
      },
      {
        id: 'role',
        header: 'Role',
        cell: (row) => (
          <Select
            id={`role-${row.userId}`}
            label=""
            value={row.role}
            onValueChange={(v) => handleRoleChange(row, v)}
            options={ROLE_OPTIONS}
          />
        ),
        width: 'w-40',
      },
      {
        id: 'status',
        header: 'Status',
        cell: (row) => (
          <Badge variant={STATUS_VARIANT[row.status] ?? 'neutral'}>{titleCase(row.status.replace(/_/g, ' '))}</Badge>
        ),
        width: 'w-44',
      },
      {
        id: 'createdAt',
        header: 'Created',
        cell: (row) => <time dateTime={row.createdAt}>{formatDate(row.createdAt)}</time>,
        width: 'w-36',
      },
      {
        id: 'actions',
        header: 'Actions',
        cell: (row) => (
          <div className="flex gap-2">
            <button
              type="button"
              onClick={() => setDisableTarget(row)}
              className="rounded-md border border-gray-300 px-2.5 py-1 text-xs font-medium text-gray-700 hover:bg-gray-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-600"
            >
              Disable
            </button>
            <button
              type="button"
              onClick={() => setDeleteTarget(row)}
              disabled={row.role === 'owner'}
              title={row.role === 'owner' ? 'Owners cannot be deleted' : undefined}
              className="rounded-md border border-red-300 px-2.5 py-1 text-xs font-medium text-red-700 hover:bg-red-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-red-600 disabled:cursor-not-allowed disabled:opacity-40"
            >
              Delete
            </button>
          </div>
        ),
        width: 'w-40',
      },
    ],
    [handleRoleChange]
  );

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Users</h1>
          <p className="mt-1 text-sm text-gray-500">Invite and manage users within a tenant.</p>
        </div>
        <button
          type="button"
          onClick={() => setInviteOpen(true)}
          disabled={!selectedTenantId}
          className="inline-flex items-center gap-1.5 rounded-md bg-blue-600 px-4 py-2 text-sm font-semibold text-white shadow-sm hover:bg-blue-500 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-600 focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:bg-blue-300"
        >
          Invite user
        </button>
      </div>

      {/* Tenant selector */}
      <div className="w-full sm:w-80">
        <Select
          id="tenant-select"
          label="Tenant"
          value={selectedTenantId}
          onValueChange={setSelectedTenantId}
          options={tenantOptions}
        />
      </div>

      {/* Empty prompt when no tenant chosen */}
      {!selectedTenantId && (
        <p className="rounded-md border border-dashed border-gray-300 bg-gray-50 p-6 text-center text-sm text-gray-500">
          Select a tenant to view and manage its users.
        </p>
      )}

      {/* Error state with retry */}
      {selectedTenantId && usersError && (
        <Alert variant="error" title="Failed to load users" dismissible={false}>
          <p>{(usersErrorObj as ApiError)?.message ?? 'User data is temporarily unavailable.'}</p>
          <button
            onClick={() => refetch()}
            className="mt-2 text-sm font-medium underline hover:no-underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-red-600 rounded"
          >
            Retry
          </button>
        </Alert>
      )}

      {/* Users table */}
      {selectedTenantId && !usersError && (
        <DataTable<AdminUserSummary>
          columns={columns}
          data={users}
          getRowKey={(row) => row.userId}
          isLoading={usersLoading}
          skeletonRows={8}
          emptyMessage="No users in this tenant yet. Invite the first one."
          caption="Tenant users"
        />
      )}

      {/* Invite modal */}
      {selectedTenantId && (
        <InviteUserModal
          open={inviteOpen}
          onOpenChange={setInviteOpen}
          tenantId={selectedTenantId}
          onInvited={(email) =>
            toast({ variant: 'success', title: 'Invitation sent', description: `${email} has been invited.` })
          }
        />
      )}

      {/* Disable confirmation */}
      <ConfirmationModal
        open={!!disableTarget}
        onOpenChange={(o) => !o && setDisableTarget(null)}
        title="Disable user?"
        description={
          disableTarget
            ? `${disableTarget.email} will be blocked from signing in until re-enabled. This does not delete their data.`
            : ''
        }
        confirmLabel="Disable"
        variant="warning"
        isLoading={disableUser.isPending}
        onConfirm={confirmDisable}
        onCancel={() => setDisableTarget(null)}
      />

      {/* Delete confirmation */}
      <ConfirmationModal
        open={!!deleteTarget}
        onOpenChange={(o) => !o && setDeleteTarget(null)}
        title="Delete user?"
        description={
          deleteTarget
            ? `${deleteTarget.email} will be permanently removed. This cannot be undone.`
            : ''
        }
        confirmLabel="Delete"
        variant="danger"
        isLoading={deleteUser.isPending}
        onConfirm={confirmDelete}
        onCancel={() => setDeleteTarget(null)}
      />
    </div>
  );
}

export default function UsersPage() {
  return (
    <AdminRouteGuard requiredResource="users" requiredAction="read">
      <UsersPageContent />
    </AdminRouteGuard>
  );
}
