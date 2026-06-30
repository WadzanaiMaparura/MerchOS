'use client';

import React, { useState, useCallback } from 'react';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import {
  useWebhooks,
  useCreateWebhook,
  useToggleWebhook,
  useDeleteWebhook,
} from '@merch-os/api-client';
import type { Webhook } from '@merch-os/api-client';
import {
  Card,
  DataTable,
  Badge,
  Input,
  ConfirmationModal,
  Alert,
  Form,
  FormField,
} from '@merch-os/ui';
import type { ColumnDef } from '@merch-os/ui';
import { useRole } from '@merch-os/auth';
import type { EventType } from '@merch-os/types';

// --- Constants ---

const MAX_WEBHOOKS = 25;

/** Available event types for webhook subscription */
const AVAILABLE_EVENTS: { value: EventType; label: string }[] = [
  { value: 'product.ingested', label: 'Product Ingested' },
  { value: 'product.enriched', label: 'Product Enriched' },
  { value: 'product.review_required', label: 'Product Review Required' },
  { value: 'product.validated', label: 'Product Validated' },
  { value: 'product.exported', label: 'Product Exported' },
  { value: 'inventory.updated', label: 'Inventory Updated' },
  { value: 'inventory.stockout', label: 'Inventory Stockout' },
  { value: 'compliance.passed', label: 'Compliance Passed' },
  { value: 'compliance.failed', label: 'Compliance Failed' },
  { value: 'compliance.rules_updated', label: 'Compliance Rules Updated' },
  { value: 'listing.published', label: 'Listing Published' },
  { value: 'taxonomy.refresh_complete', label: 'Taxonomy Refresh Complete' },
  { value: 'ingestion.failed', label: 'Ingestion Failed' },
  { value: 'image.moderation_rejected', label: 'Image Moderation Rejected' },
  { value: 'billing.payment_succeeded', label: 'Billing Payment Succeeded' },
  { value: 'billing.payment_failed', label: 'Billing Payment Failed' },
  { value: 'billing.usage_limit_reached', label: 'Billing Usage Limit Reached' },
];

// --- Zod Validation Schema ---

const webhookFormSchema = z.object({
  url: z
    .string()
    .min(1, 'URL is required')
    .max(2048, 'URL must be 2048 characters or fewer')
    .refine((val) => val.startsWith('https://'), {
      message: 'URL must begin with "https://"',
    })
    .refine(
      (val) => {
        try {
          new URL(val);
          return true;
        } catch {
          return false;
        }
      },
      { message: 'URL must be a valid URI format' }
    ),
  events: z
    .array(z.string())
    .min(1, 'At least one event subscription is required'),
});

type WebhookFormData = z.infer<typeof webhookFormSchema>;

// --- Webhook Settings Page ---

export default function WebhooksSettingsPage() {
  const role = useRole();

  // Only admin+ roles can access webhook settings (Requirement 3.4)
  if (!role || (role !== 'admin' && role !== 'owner')) {
    return (
      <div className="flex items-center justify-center py-16">
        <div className="max-w-md">
          <Alert variant="error" title="Access Denied">
            Webhook configuration requires admin or owner role. Please contact
            your organisation owner for access.
          </Alert>
        </div>
      </div>
    );
  }

  return <WebhooksContent />;
}

function WebhooksContent() {
  const {
    data: webhooks,
    isLoading,
    isError,
    refetch,
  } = useWebhooks();

  const createWebhookMutation = useCreateWebhook();
  const toggleWebhookMutation = useToggleWebhook();
  const deleteWebhookMutation = useDeleteWebhook();

  const [showAddForm, setShowAddForm] = useState(false);
  const [deleteTarget, setDeleteTarget] = useState<Webhook | null>(null);
  const [confirmDeleteOpen, setConfirmDeleteOpen] = useState(false);
  const [successMessage, setSuccessMessage] = useState<string | null>(null);
  const [operationError, setOperationError] = useState<string | null>(null);

  // Clear success message after 3 seconds
  const showSuccess = useCallback((message: string) => {
    setSuccessMessage(message);
    setTimeout(() => setSuccessMessage(null), 3000);
  }, []);

  // --- Toggle webhook active status ---
  const handleToggle = useCallback(
    (webhook: Webhook) => {
      setOperationError(null);
      toggleWebhookMutation.mutate(
        { webhookId: webhook.webhookId, active: !webhook.active },
        {
          onSuccess: () => {
            showSuccess(
              `Webhook ${!webhook.active ? 'activated' : 'deactivated'} successfully.`
            );
          },
          onError: (error) => {
            setOperationError(
              `Failed to toggle webhook status: ${error.message ?? 'Unknown error'}. Please try again.`
            );
          },
        }
      );
    },
    [toggleWebhookMutation, showSuccess]
  );

  // --- Delete webhook ---
  const handleDeleteClick = useCallback((webhook: Webhook) => {
    setDeleteTarget(webhook);
    setConfirmDeleteOpen(true);
  }, []);

  const handleDeleteConfirm = useCallback(() => {
    if (!deleteTarget) return;
    setOperationError(null);
    deleteWebhookMutation.mutate(
      { webhookId: deleteTarget.webhookId },
      {
        onSuccess: () => {
          setConfirmDeleteOpen(false);
          setDeleteTarget(null);
          showSuccess('Webhook deleted successfully.');
        },
        onError: (error) => {
          setConfirmDeleteOpen(false);
          setDeleteTarget(null);
          setOperationError(
            `Failed to delete webhook: ${error.message ?? 'Unknown error'}. Please try again.`
          );
        },
      }
    );
  }, [deleteTarget, deleteWebhookMutation, showSuccess]);

  // --- Table columns ---
  const columns: ColumnDef<Webhook>[] = [
    {
      id: 'url',
      header: 'URL',
      cell: (row) => (
        <span className="max-w-[300px] truncate block" title={row.url}>
          {row.url}
        </span>
      ),
    },
    {
      id: 'events',
      header: 'Subscribed Events',
      cell: (row) => (
        <div className="flex flex-wrap gap-1">
          {row.events.map((event) => (
            <Badge key={event} variant="info">
              {event}
            </Badge>
          ))}
        </div>
      ),
    },
    {
      id: 'active',
      header: 'Status',
      cell: (row) => (
        <Badge variant={row.active ? 'success' : 'neutral'}>
          {row.active ? 'Active' : 'Inactive'}
        </Badge>
      ),
    },
    {
      id: 'actions',
      header: 'Actions',
      cell: (row) => (
        <div className="flex items-center gap-2">
          <button
            onClick={(e) => {
              e.stopPropagation();
              handleToggle(row);
            }}
            disabled={toggleWebhookMutation.isPending}
            className="rounded-md border border-gray-300 bg-white px-3 py-1.5 text-xs font-medium text-gray-700 hover:bg-gray-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-600 focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50"
            aria-label={`${row.active ? 'Deactivate' : 'Activate'} webhook ${row.url}`}
          >
            {row.active ? 'Deactivate' : 'Activate'}
          </button>
          <button
            onClick={(e) => {
              e.stopPropagation();
              handleDeleteClick(row);
            }}
            disabled={deleteWebhookMutation.isPending}
            className="rounded-md border border-red-300 bg-white px-3 py-1.5 text-xs font-medium text-red-700 hover:bg-red-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-red-600 focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50"
            aria-label={`Delete webhook ${row.url}`}
          >
            Delete
          </button>
        </div>
      ),
    },
  ];

  // --- Error state with retry (Requirement 11.7) ---
  if (isError) {
    return (
      <div className="space-y-4 p-6">
        <h1 className="text-2xl font-bold text-gray-900">Webhook Settings</h1>
        <Alert variant="error" title="Unable to load webhooks">
          <p className="mt-1">
            Webhook configuration could not be loaded. Please try again.
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

  // Sort by creation date descending (Requirement 11.1)
  const webhookList = [...(webhooks ?? [])].sort(
    (a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime()
  );
  const isAtLimit = webhookList.length >= MAX_WEBHOOKS;

  return (
    <div className="space-y-6 p-6">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold text-gray-900">Webhook Settings</h1>
        {!showAddForm && (
          <button
            onClick={() => setShowAddForm(true)}
            disabled={isAtLimit}
            className="rounded-md bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-700 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-600 focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50"
            aria-label="Add new webhook"
          >
            Add Webhook
          </button>
        )}
      </div>

      {/* Limit warning */}
      {isAtLimit && (
        <Alert variant="warning" title="Webhook limit reached">
          You have reached the maximum of {MAX_WEBHOOKS} webhooks. Remove an
          existing webhook before adding a new one.
        </Alert>
      )}

      {/* Success confirmation (Requirement 11.5) */}
      {successMessage && (
        <Alert variant="success" dismissible onDismiss={() => setSuccessMessage(null)}>
          {successMessage}
        </Alert>
      )}

      {/* Operation error with retry context (Requirement 11.7) */}
      {operationError && (
        <Alert
          variant="error"
          title="Operation Failed"
          dismissible
          onDismiss={() => setOperationError(null)}
        >
          {operationError}
        </Alert>
      )}

      {/* Add Webhook Form */}
      {showAddForm && !isAtLimit && (
        <AddWebhookForm
          onSuccess={() => {
            setShowAddForm(false);
            showSuccess('Webhook added successfully.');
          }}
          onCancel={() => setShowAddForm(false)}
          onError={(msg) => setOperationError(msg)}
          createMutation={createWebhookMutation}
        />
      )}

      {/* Webhook Table or Empty State */}
      {webhookList.length === 0 && !isLoading ? (
        <EmptyState onAdd={() => setShowAddForm(true)} />
      ) : (
        <Card>
          <DataTable
            columns={columns}
            data={webhookList}
            getRowKey={(row) => row.webhookId}
            isLoading={isLoading}
            totalItems={webhookList.length}
            emptyMessage="No webhooks configured."
            caption="Configured webhooks"
          />
        </Card>
      )}

      {/* Delete Confirmation Modal (Requirement 11.6) */}
      <ConfirmationModal
        open={confirmDeleteOpen}
        onOpenChange={setConfirmDeleteOpen}
        title="Delete Webhook"
        description={`Are you sure you want to delete the webhook for "${deleteTarget?.url ?? ''}"? This action cannot be undone.`}
        confirmLabel="Delete"
        cancelLabel="Cancel"
        onConfirm={handleDeleteConfirm}
        onCancel={() => {
          setConfirmDeleteOpen(false);
          setDeleteTarget(null);
        }}
        variant="danger"
        isLoading={deleteWebhookMutation.isPending}
      />
    </div>
  );
}

// --- Empty State Component ---

function EmptyState({ onAdd }: { onAdd: () => void }) {
  return (
    <Card>
      <div className="flex flex-col items-center justify-center py-12 text-center">
        <svg
          xmlns="http://www.w3.org/2000/svg"
          className="h-12 w-12 text-gray-400"
          fill="none"
          viewBox="0 0 24 24"
          stroke="currentColor"
          aria-hidden="true"
        >
          <path
            strokeLinecap="round"
            strokeLinejoin="round"
            strokeWidth={1.5}
            d="M13.828 10.172a4 4 0 00-5.656 0l-4 4a4 4 0 105.656 5.656l1.102-1.101m-.758-4.899a4 4 0 005.656 0l4-4a4 4 0 00-5.656-5.656l-1.1 1.1"
          />
        </svg>
        <h3 className="mt-4 text-sm font-semibold text-gray-900">
          No webhooks configured
        </h3>
        <p className="mt-1 text-sm text-gray-500">
          Configure webhooks to receive notifications about platform events in
          your external systems.
        </p>
        <button
          onClick={onAdd}
          className="mt-4 rounded-md bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-700 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-600 focus-visible:ring-offset-2"
        >
          Add Webhook
        </button>
      </div>
    </Card>
  );
}

// --- Add Webhook Form ---

interface AddWebhookFormProps {
  onSuccess: () => void;
  onCancel: () => void;
  onError: (message: string) => void;
  createMutation: ReturnType<typeof useCreateWebhook>;
}

function AddWebhookForm({
  onSuccess,
  onCancel,
  onError,
  createMutation,
}: AddWebhookFormProps) {
  const form = useForm<WebhookFormData>({
    resolver: zodResolver(webhookFormSchema),
    defaultValues: {
      url: '',
      events: [],
    },
  });

  const handleSubmit = (data: WebhookFormData) => {
    createMutation.mutate(
      {
        url: data.url,
        events: data.events as EventType[],
      },
      {
        onSuccess: () => {
          form.reset();
          onSuccess();
        },
        onError: (error) => {
          onError(
            `Failed to add webhook: ${error.message ?? 'Unknown error'}. Please try again.`
          );
        },
      }
    );
  };

  const selectedEvents = form.watch('events');

  const toggleEvent = (eventValue: string) => {
    const current = form.getValues('events');
    if (current.includes(eventValue)) {
      form.setValue(
        'events',
        current.filter((e) => e !== eventValue),
        { shouldValidate: true }
      );
    } else {
      form.setValue('events', [...current, eventValue], {
        shouldValidate: true,
      });
    }
  };

  return (
    <Card title="Add New Webhook">
      <Form form={form} onSubmit={handleSubmit} aria-label="Add webhook form">
        <div className="space-y-4">
          {/* URL Field */}
          <FormField name="url" label="Webhook URL" required>
            {({ field }) => (
              <Input
                {...field}
                type="text"
                placeholder="https://example.com/webhook"
                aria-label="Webhook URL"
              />
            )}
          </FormField>

          {/* Event Subscriptions */}
          <div className="flex flex-col gap-1.5">
            <label className="text-sm font-medium text-gray-700">
              Event Subscriptions
              <span className="ml-0.5 text-red-500" aria-hidden="true">
                *
              </span>
            </label>
            <p className="text-xs text-gray-500">
              Select at least one event type to subscribe to.
            </p>
            <div
              className="mt-2 grid grid-cols-1 gap-2 sm:grid-cols-2 lg:grid-cols-3"
              role="group"
              aria-label="Event subscriptions"
            >
              {AVAILABLE_EVENTS.map((event) => (
                <label
                  key={event.value}
                  className={`flex cursor-pointer items-center gap-2 rounded-md border p-2 text-sm transition-colors ${
                    selectedEvents.includes(event.value)
                      ? 'border-blue-500 bg-blue-50 text-blue-800'
                      : 'border-gray-200 bg-white text-gray-700 hover:border-gray-300'
                  }`}
                >
                  <input
                    type="checkbox"
                    checked={selectedEvents.includes(event.value)}
                    onChange={() => toggleEvent(event.value)}
                    className="h-4 w-4 rounded border-gray-300 text-blue-600 focus:ring-blue-500"
                    aria-label={event.label}
                  />
                  <span>{event.label}</span>
                </label>
              ))}
            </div>
            {form.formState.errors.events && (
              <p
                className="text-sm text-red-600"
                role="alert"
                aria-live="assertive"
              >
                {form.formState.errors.events.message}
              </p>
            )}
          </div>

          {/* Form Actions */}
          <div className="flex justify-end gap-3 pt-2">
            <button
              type="button"
              onClick={onCancel}
              className="rounded-md border border-gray-300 bg-white px-4 py-2 text-sm font-medium text-gray-700 shadow-sm hover:bg-gray-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-600 focus-visible:ring-offset-2"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={createMutation.isPending}
              aria-busy={createMutation.isPending}
              className="rounded-md bg-blue-600 px-4 py-2 text-sm font-medium text-white shadow-sm hover:bg-blue-700 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-600 focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50"
            >
              {createMutation.isPending ? 'Adding…' : 'Add Webhook'}
            </button>
          </div>
        </div>
      </Form>
    </Card>
  );
}
