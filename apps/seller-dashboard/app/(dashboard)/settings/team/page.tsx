'use client';

import React, { useState } from 'react';
import {
  useTeamMembers,
  useInviteMember,
  useChangeRole,
  useRemoveMember,
} from '@merch-os/api-client';
import type { TeamMember } from '@merch-os/api-client';
import { Card, Badge, Input, Select, ConfirmationModal, Alert } from '@merch-os/ui';
import type { BadgeVariant } from '@merch-os/ui';
import { useAuth, useRole } from '@merch-os/auth';
import type { SellerRole } from '@merch-os/types';

// --- Role options for invite and role change (excludes 'owner') ---

const ASSIGNABLE_ROLES = [
  { value: 'viewer', label: 'Viewer' },
  { value: 'editor', label: 'Editor' },
  { value: 'admin', label: 'Admin' },
] as const;

function getRoleBadgeVariant(role: SellerRole): BadgeVariant {
  switch (role) {
    case 'owner':
      return 'info';
    case 'admin':
      return 'warning';
    case 'editor':
      return 'success';
    case 'viewer':
      return 'neutral';
    default:
      return 'default';
  }
}

// --- Email validation helper ---

function isValidEmail(email: string): boolean {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
}

// --- Main Team Page ---

/**
 * TeamPage — Team member management for tenant owners.
 * Displays team member list, invite form, role management, and member removal.
 *
 * Validates: Requirements 10.1, 10.2, 10.3, 10.4, 10.5, 10.6
 */
export default function TeamPage() {
  const role = useRole();
  const { user } = useAuth();
  const isOwner = role === 'owner';
  const currentUserId = user?.userId ?? '';

  const {
    data: members,
    isLoading,
    isError,
    refetch,
  } = useTeamMembers();

  const inviteMutation = useInviteMember();
  const changeRoleMutation = useChangeRole();
  const removeMutation = useRemoveMember();

  // Invite form state
  const [inviteEmail, setInviteEmail] = useState('');
  const [inviteRole, setInviteRole] = useState<string>('viewer');
  const [inviteError, setInviteError] = useState<string | null>(null);
  const [emailValidationError, setEmailValidationError] = useState<string | null>(null);

  // Role change state
  const [roleChangeError, setRoleChangeError] = useState<string | null>(null);

  // Remove member state
  const [removeTarget, setRemoveTarget] = useState<TeamMember | null>(null);
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [removeError, setRemoveError] = useState<string | null>(null);

  // --- Invite handler (Requirement 10.2, 10.3) ---

  const handleInvite = async (e: React.FormEvent) => {
    e.preventDefault();
    setInviteError(null);
    setEmailValidationError(null);

    if (!inviteEmail.trim()) {
      setEmailValidationError('Email is required.');
      return;
    }

    if (!isValidEmail(inviteEmail.trim())) {
      setEmailValidationError('Please enter a valid email address.');
      return;
    }

    try {
      await inviteMutation.mutateAsync({
        email: inviteEmail.trim(),
        role: inviteRole as Exclude<SellerRole, 'owner'>,
      });
      // Clear form on success
      setInviteEmail('');
      setInviteRole('viewer');
    } catch (err: unknown) {
      // Preserve input on failure (Requirement 10.3)
      const message =
        err && typeof err === 'object' && 'message' in err
          ? (err as { message: string }).message
          : 'Failed to send invitation. Please try again.';
      setInviteError(message);
    }
  };

  // --- Role change handler (Requirement 10.4) ---

  const handleRoleChange = async (userId: string, newRole: string) => {
    setRoleChangeError(null);
    try {
      await changeRoleMutation.mutateAsync({
        userId,
        role: newRole as Exclude<SellerRole, 'owner'>,
      });
    } catch (err: unknown) {
      const message =
        err && typeof err === 'object' && 'message' in err
          ? (err as { message: string }).message
          : 'Failed to change role. Please try again.';
      setRoleChangeError(message);
    }
  };

  // --- Remove member handler (Requirement 10.5) ---

  const handleRemoveClick = (member: TeamMember) => {
    setRemoveError(null);
    setRemoveTarget(member);
    setConfirmOpen(true);
  };

  const handleRemoveConfirm = async () => {
    if (!removeTarget) return;
    try {
      await removeMutation.mutateAsync({ userId: removeTarget.userId });
      setConfirmOpen(false);
      setRemoveTarget(null);
    } catch (err: unknown) {
      const message =
        err && typeof err === 'object' && 'message' in err
          ? (err as { message: string }).message
          : 'Failed to remove team member. Please try again.';
      setRemoveError(message);
      setConfirmOpen(false);
      setRemoveTarget(null);
    }
  };

  const handleRemoveCancel = () => {
    setConfirmOpen(false);
    setRemoveTarget(null);
  };

  // --- Loading state ---
  if (isLoading) {
    return (
      <div className="space-y-6">
        <h1 className="text-2xl font-bold text-gray-900">Team</h1>
        <div className="space-y-4">
          {Array.from({ length: 3 }).map((_, i) => (
            <div
              key={i}
              className="h-16 animate-pulse rounded-lg border border-gray-200 bg-gray-100"
              aria-hidden="true"
            />
          ))}
        </div>
        <span className="sr-only">Loading team members...</span>
      </div>
    );
  }

  // --- Error state ---
  if (isError) {
    return (
      <div className="space-y-4">
        <h1 className="text-2xl font-bold text-gray-900">Team</h1>
        <Alert variant="error" title="Unable to load team members">
          <p className="mt-1">
            Team information is temporarily unavailable. Please try again.
          </p>
          <button
            onClick={() => refetch()}
            className="mt-3 rounded-md bg-red-600 px-4 py-2 text-sm font-medium text-white hover:bg-red-700 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-red-600 focus-visible:ring-offset-2"
          >
            Retry
          </button>
        </Alert>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold text-gray-900">Team</h1>
        <p className="text-sm text-gray-500">
          Manage your organisation&apos;s team members
        </p>
      </div>

      {/* Role change error alert */}
      {roleChangeError && (
        <Alert
          variant="error"
          title="Role Change Failed"
          dismissible
          onDismiss={() => setRoleChangeError(null)}
        >
          {roleChangeError}
        </Alert>
      )}

      {/* Remove member error alert */}
      {removeError && (
        <Alert
          variant="error"
          title="Removal Failed"
          dismissible
          onDismiss={() => setRemoveError(null)}
        >
          {removeError}
        </Alert>
      )}

      {/* Invite Form — Owner only (Requirement 10.2) */}
      {isOwner && (
        <Card title="Invite Team Member">
          <form onSubmit={handleInvite} className="space-y-4">
            {inviteError && (
              <Alert
                variant="error"
                title="Invitation Failed"
                dismissible
                onDismiss={() => setInviteError(null)}
              >
                {inviteError}
              </Alert>
            )}
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
              <div className="sm:col-span-1">
                <Input
                  type="email"
                  label="Email address"
                  placeholder="colleague@example.com"
                  value={inviteEmail}
                  onChange={(e) => {
                    setInviteEmail(e.target.value);
                    if (emailValidationError) setEmailValidationError(null);
                  }}
                  error={emailValidationError ?? undefined}
                  required
                  aria-label="Email address for new team member"
                />
              </div>
              <div className="sm:col-span-1">
                <Select
                  label="Role"
                  value={inviteRole}
                  onValueChange={setInviteRole}
                  options={ASSIGNABLE_ROLES.map((r) => ({
                    value: r.value,
                    label: r.label,
                  }))}
                  placeholder="Select a role"
                  id="invite-role-select"
                />
              </div>
              <div className="flex items-end sm:col-span-1">
                <button
                  type="submit"
                  disabled={inviteMutation.isPending}
                  aria-busy={inviteMutation.isPending}
                  className="w-full rounded-md bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-700 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-600 focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50"
                >
                  {inviteMutation.isPending ? (
                    <span className="flex items-center justify-center gap-2">
                      <svg
                        className="h-4 w-4 animate-spin"
                        xmlns="http://www.w3.org/2000/svg"
                        fill="none"
                        viewBox="0 0 24 24"
                        aria-hidden="true"
                      >
                        <circle
                          className="opacity-25"
                          cx="12"
                          cy="12"
                          r="10"
                          stroke="currentColor"
                          strokeWidth="4"
                        />
                        <path
                          className="opacity-75"
                          fill="currentColor"
                          d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"
                        />
                      </svg>
                      Sending…
                    </span>
                  ) : (
                    'Send Invitation'
                  )}
                </button>
              </div>
            </div>
          </form>
        </Card>
      )}

      {/* Team Members List (Requirement 10.1) */}
      <Card title="Team Members">
        <div className="overflow-x-auto">
          <table className="w-full text-left text-sm" aria-label="Team members">
            <thead>
              <tr className="border-b border-gray-200">
                <th scope="col" className="pb-3 pr-4 font-medium text-gray-700">
                  Name
                </th>
                <th scope="col" className="pb-3 pr-4 font-medium text-gray-700">
                  Email
                </th>
                <th scope="col" className="pb-3 pr-4 font-medium text-gray-700">
                  Role
                </th>
                {isOwner && (
                  <th scope="col" className="pb-3 font-medium text-gray-700">
                    Actions
                  </th>
                )}
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {members?.map((member) => {
                const isCurrentUser = member.userId === currentUserId;

                return (
                  <tr
                    key={member.userId}
                    className={isCurrentUser ? 'bg-blue-50/50' : ''}
                  >
                    <td className="py-3 pr-4">
                      <div className="flex items-center gap-2">
                        <span className="font-medium text-gray-900">
                          {member.name}
                        </span>
                        {isCurrentUser && (
                          <span className="text-xs text-gray-500">(you)</span>
                        )}
                      </div>
                    </td>
                    <td className="py-3 pr-4 text-gray-600">{member.email}</td>
                    <td className="py-3 pr-4">
                      {isOwner && !isCurrentUser && member.role !== 'owner' ? (
                        <Select
                          label="Change role"
                          value={member.role}
                          onValueChange={(newRole) =>
                            handleRoleChange(member.userId, newRole)
                          }
                          options={ASSIGNABLE_ROLES.map((r) => ({
                            value: r.value,
                            label: r.label,
                          }))}
                          id={`role-select-${member.userId}`}
                          disabled={
                            changeRoleMutation.isPending &&
                            changeRoleMutation.variables?.userId === member.userId
                          }
                        />
                      ) : (
                        <Badge variant={getRoleBadgeVariant(member.role)}>
                          {member.role.charAt(0).toUpperCase() +
                            member.role.slice(1)}
                        </Badge>
                      )}
                    </td>
                    {isOwner && (
                      <td className="py-3">
                        <button
                          onClick={() => handleRemoveClick(member)}
                          disabled={isCurrentUser || member.role === 'owner'}
                          aria-label={`Remove ${member.name} from team`}
                          className="rounded-md border border-red-300 bg-white px-3 py-1.5 text-sm font-medium text-red-700 hover:bg-red-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-red-600 focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50"
                        >
                          Remove
                        </button>
                      </td>
                    )}
                  </tr>
                );
              })}
              {(!members || members.length === 0) && (
                <tr>
                  <td
                    colSpan={isOwner ? 4 : 3}
                    className="py-8 text-center text-sm text-gray-500"
                  >
                    No team members found.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </Card>

      {/* Remove Member Confirmation Modal (Requirement 10.5) */}
      <ConfirmationModal
        open={confirmOpen}
        onOpenChange={setConfirmOpen}
        title="Remove Team Member"
        description={`Are you sure you want to remove ${removeTarget?.name ?? 'this member'} (${removeTarget?.email ?? ''}) from your organisation? They will lose access to all team resources immediately.`}
        confirmLabel="Remove Member"
        cancelLabel="Cancel"
        onConfirm={handleRemoveConfirm}
        onCancel={handleRemoveCancel}
        variant="danger"
        isLoading={removeMutation.isPending}
      />
    </div>
  );
}
