'use client';

/**
 * InviteUserModal — form to invite a new user to the selected tenant.
 * Calls POST /auth/invite via useInviteUser. Surfaces field validation and the
 * server's USER_EXISTS (409) / FORBIDDEN (403) errors inline.
 */

import React, { useCallback, useState } from 'react';
import { z } from 'zod';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { Modal, Form, FormField, Input, Select } from '@merch-os/ui';
import type { SelectOption } from '@merch-os/ui';
import { useInviteUser } from '@merch-os/api-client';
import type { ApiError } from '@merch-os/api-client';
import type { SellerRole } from '@merch-os/types';

const ROLE_OPTIONS: SelectOption[] = [
  { value: 'viewer', label: 'Viewer' },
  { value: 'editor', label: 'Editor' },
  { value: 'admin', label: 'Admin' },
  { value: 'owner', label: 'Owner' },
];

const inviteSchema = z.object({
  email: z.string().min(1, 'Email is required').email('Enter a valid email address'),
  role: z.enum(['viewer', 'editor', 'admin', 'owner']),
});

type InviteFormData = z.infer<typeof inviteSchema>;

export interface InviteUserModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  tenantId: string;
  onInvited: (email: string) => void;
}

export function InviteUserModal({ open, onOpenChange, tenantId, onInvited }: InviteUserModalProps) {
  const inviteUser = useInviteUser();
  const [formError, setFormError] = useState<string | null>(null);

  const form = useForm<InviteFormData>({
    resolver: zodResolver(inviteSchema),
    defaultValues: { email: '', role: 'viewer' },
  });

  const onSubmit = useCallback(
    async (data: InviteFormData) => {
      setFormError(null);
      try {
        await inviteUser.mutateAsync({
          tenantId,
          email: data.email,
          role: data.role as SellerRole,
        });
        onInvited(data.email);
        form.reset();
        onOpenChange(false);
      } catch (err) {
        const apiErr = err as ApiError;
        // Map the server's known error codes to friendly copy.
        if (apiErr.code === 'USER_EXISTS' || apiErr.statusCode === 409) {
          setFormError('A user with this email already exists.');
        } else if (apiErr.code === 'FORBIDDEN' || apiErr.statusCode === 403) {
          setFormError('You are not authorized to invite users to this tenant.');
        } else {
          setFormError(apiErr.message || 'Failed to send the invitation. Please try again.');
        }
      }
    },
    [inviteUser, tenantId, onInvited, form, onOpenChange]
  );

  return (
    <Modal
      open={open}
      onOpenChange={onOpenChange}
      title="Invite user"
      description="Create a tenant user and assign a role. They will receive access per your onboarding process."
    >
      {formError && (
        <div
          role="alert"
          aria-live="assertive"
          className="mb-4 rounded-md border border-red-200 bg-red-50 p-3 text-sm text-red-800"
        >
          {formError}
        </div>
      )}

      <Form form={form} onSubmit={onSubmit} aria-label="Invite user form" className="space-y-5">
        <FormField<InviteFormData> name="email" label="Email address" required>
          {({ field }) => (
            <Input
              {...field}
              type="email"
              placeholder="user@example.com"
              autoComplete="off"
              disabled={inviteUser.isPending}
            />
          )}
        </FormField>

        <FormField<InviteFormData> name="role" label="Role" required>
          {({ field }) => (
            <Select
              id="invite-role"
              label=""
              value={field.value}
              onValueChange={field.onChange}
              options={ROLE_OPTIONS}
            />
          )}
        </FormField>

        <div className="flex justify-end gap-3 pt-2">
          <button
            type="button"
            onClick={() => onOpenChange(false)}
            disabled={inviteUser.isPending}
            className="rounded-md border border-gray-300 bg-white px-4 py-2 text-sm font-medium text-gray-700 shadow-sm hover:bg-gray-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-600 focus-visible:ring-offset-2 disabled:opacity-50"
          >
            Cancel
          </button>
          <button
            type="submit"
            disabled={inviteUser.isPending}
            aria-busy={inviteUser.isPending}
            className="rounded-md bg-blue-600 px-4 py-2 text-sm font-semibold text-white shadow-sm hover:bg-blue-500 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-600 focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:bg-blue-300"
          >
            {inviteUser.isPending ? 'Sending…' : 'Send invite'}
          </button>
        </div>
      </Form>
    </Modal>
  );
}
