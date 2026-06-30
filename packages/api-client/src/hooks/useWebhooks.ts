'use client';

import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import type { EventType } from '@merch-os/types';
import { useApiClient } from '../context';
import type { ApiError } from '../errors';

/** Query key factory for webhooks domain */
export const webhookKeys = {
  all: ['webhooks'] as const,
  list: () => [...webhookKeys.all, 'list'] as const,
};

/** Represents a configured webhook */
export interface Webhook {
  webhookId: string;
  url: string;
  events: EventType[];
  active: boolean;
  createdAt: string;
}

export interface CreateWebhookPayload {
  /** Must begin with "https://" and be no longer than 2048 characters */
  url: string;
  /** At least one event type must be selected */
  events: EventType[];
}

export interface ToggleWebhookPayload {
  webhookId: string;
  active: boolean;
}

export interface DeleteWebhookPayload {
  webhookId: string;
}

/**
 * Fetches all configured webhooks for the tenant.
 * Sorted by creation date descending, up to 25 per tenant.
 * Validates: Requirements 11.1
 */
export function useWebhooks() {
  const client = useApiClient();

  return useQuery<Webhook[], ApiError>({
    queryKey: webhookKeys.list(),
    queryFn: async () => {
      const { data } = await client.get<Webhook[]>('/webhooks');
      return data;
    },
  });
}

/**
 * Mutation to create a new webhook configuration.
 * Invalidates webhook queries on success.
 * Validates: Requirements 11.3
 */
export function useCreateWebhook() {
  const client = useApiClient();
  const queryClient = useQueryClient();

  return useMutation<Webhook, ApiError, CreateWebhookPayload>({
    mutationFn: async (payload) => {
      const { data } = await client.post<Webhook>('/webhooks', payload);
      return data;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: webhookKeys.all });
    },
  });
}

/**
 * Mutation to toggle a webhook's active status.
 * Invalidates webhook queries on success.
 * Validates: Requirements 11.5
 */
export function useToggleWebhook() {
  const client = useApiClient();
  const queryClient = useQueryClient();

  return useMutation<void, ApiError, ToggleWebhookPayload>({
    mutationFn: async (payload) => {
      await client.patch(`/webhooks/${payload.webhookId}`, {
        active: payload.active,
      });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: webhookKeys.all });
    },
  });
}

/**
 * Mutation to delete a webhook configuration.
 * Invalidates webhook queries on success.
 * Validates: Requirements 11.6
 */
export function useDeleteWebhook() {
  const client = useApiClient();
  const queryClient = useQueryClient();

  return useMutation<void, ApiError, DeleteWebhookPayload>({
    mutationFn: async (payload) => {
      await client.delete(`/webhooks/${payload.webhookId}`);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: webhookKeys.all });
    },
  });
}
