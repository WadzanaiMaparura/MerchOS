'use client';

import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import type { ChannelId } from '@merch-os/types';
import { useApiClient } from '../context';
import type { ApiError } from '../errors';

/** Query key factory for channels domain */
export const channelKeys = {
  all: ['channels'] as const,
  list: () => [...channelKeys.all, 'list'] as const,
};

/** Represents a marketplace channel connection */
export interface Channel {
  channelId: ChannelId;
  name: string;
  connected: boolean;
  connectedAt?: string;
  shopUrl?: string;
}

export interface ConnectChannelPayload {
  channelId: ChannelId;
  /** OAuth callback URL for the channel connection flow */
  callbackUrl?: string;
}

export interface ConnectChannelResult {
  /** OAuth authorization URL to redirect the user to */
  authorizationUrl: string;
}

export interface DisconnectChannelPayload {
  channelId: ChannelId;
}

/**
 * Fetches all supported channels with their connection status.
 * Validates: Requirements 9.1
 */
export function useChannels() {
  const client = useApiClient();

  return useQuery<Channel[], ApiError>({
    queryKey: channelKeys.list(),
    queryFn: async () => {
      const { data } = await client.get<Channel[]>('/channels');
      return data;
    },
  });
}

/**
 * Mutation to initiate a channel OAuth connection.
 * Returns the authorization URL for the OAuth redirect.
 * Validates: Requirements 9.2
 */
export function useConnectChannel() {
  const client = useApiClient();
  const queryClient = useQueryClient();

  return useMutation<ConnectChannelResult, ApiError, ConnectChannelPayload>({
    mutationFn: async (payload) => {
      const { data } = await client.post<ConnectChannelResult>(
        `/channels/${payload.channelId}/connect`,
        { callbackUrl: payload.callbackUrl }
      );
      return data;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: channelKeys.all });
    },
  });
}

/**
 * Mutation to disconnect a channel integration.
 * Invalidates channel queries on success.
 * Validates: Requirements 9.4
 */
export function useDisconnectChannel() {
  const client = useApiClient();
  const queryClient = useQueryClient();

  return useMutation<void, ApiError, DisconnectChannelPayload>({
    mutationFn: async (payload) => {
      await client.post(`/channels/${payload.channelId}/disconnect`);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: channelKeys.all });
    },
  });
}
