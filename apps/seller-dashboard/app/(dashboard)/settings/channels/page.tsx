'use client';

import React, { useState, useEffect } from 'react';
import { useSearchParams } from 'next/navigation';
import {
  useChannels,
  useConnectChannel,
  useDisconnectChannel,
} from '@merch-os/api-client';
import type { Channel } from '@merch-os/api-client';
import { Card, Badge, ConfirmationModal, Alert } from '@merch-os/ui';
import type { BadgeVariant } from '@merch-os/ui';
import { useRole } from '@merch-os/auth';
import type { ChannelId } from '@merch-os/types';

// --- Channel metadata for display ---

interface ChannelMeta {
  channelId: ChannelId;
  label: string;
  description: string;
  icon: React.ReactNode;
}

const CHANNEL_META: ChannelMeta[] = [
  {
    channelId: 'takealot',
    label: 'Takealot',
    description: 'South Africa\'s leading online retailer',
    icon: <ChannelIcon letter="T" color="bg-blue-600" />,
  },
  {
    channelId: 'amazon',
    label: 'Amazon',
    description: 'Global marketplace',
    icon: <ChannelIcon letter="A" color="bg-orange-500" />,
  },
  {
    channelId: 'makro',
    label: 'Makro',
    description: 'Wholesale and retail marketplace',
    icon: <ChannelIcon letter="M" color="bg-red-600" />,
  },
  {
    channelId: 'shopify',
    label: 'Shopify',
    description: 'E-commerce platform',
    icon: <ChannelIcon letter="S" color="bg-green-600" />,
  },
  {
    channelId: 'woocommerce',
    label: 'WooCommerce',
    description: 'WordPress e-commerce plugin',
    icon: <ChannelIcon letter="W" color="bg-purple-600" />,
  },
  {
    channelId: 'custom',
    label: 'Custom',
    description: 'Custom channel integration',
    icon: <ChannelIcon letter="C" color="bg-gray-600" />,
  },
];

function ChannelIcon({ letter, color }: { letter: string; color: string }) {
  return (
    <div
      className={`flex h-10 w-10 items-center justify-center rounded-lg ${color} text-white font-bold text-lg`}
      aria-hidden="true"
    >
      {letter}
    </div>
  );
}

// --- Main Channels Page ---

/**
 * ChannelsPage — Displays all supported channels with connection status.
 * Allows admin+ roles to connect/disconnect channels via OAuth.
 *
 * Validates: Requirements 9.1, 9.2, 9.3, 9.4, 9.5, 9.6
 */
export default function ChannelsPage() {
  const role = useRole();
  const searchParams = useSearchParams();
  const isAdminOrAbove = role === 'admin' || role === 'owner';

  const {
    data: channels,
    isLoading,
    isError,
    refetch,
  } = useChannels();

  const connectMutation = useConnectChannel();
  const disconnectMutation = useDisconnectChannel();

  // State for disconnect confirmation
  const [disconnectTarget, setDisconnectTarget] = useState<ChannelId | null>(null);
  const [confirmOpen, setConfirmOpen] = useState(false);

  // Error states
  const [connectError, setConnectError] = useState<string | null>(null);
  const [disconnectError, setDisconnectError] = useState<string | null>(null);

  // Handle OAuth failure/cancel from callback URL params (Requirement 9.3)
  useEffect(() => {
    const error = searchParams.get('error');
    const errorDescription = searchParams.get('error_description');
    if (error) {
      setConnectError(
        errorDescription || 'The channel connection was not established. Please try again.'
      );
    }
  }, [searchParams]);

  // --- Handlers ---

  const handleConnect = async (channelId: ChannelId) => {
    setConnectError(null);
    try {
      const result = await connectMutation.mutateAsync({
        channelId,
        callbackUrl: window.location.href,
      });
      // Redirect to OAuth authorization URL (Requirement 9.2)
      window.location.href = result.authorizationUrl;
    } catch (err: unknown) {
      // OAuth initiation failed (Requirement 9.3)
      const message =
        err && typeof err === 'object' && 'message' in err
          ? (err as { message: string }).message
          : 'Failed to initiate channel connection. Please try again.';
      setConnectError(message);
    }
  };

  const handleDisconnectClick = (channelId: ChannelId) => {
    setDisconnectError(null);
    setDisconnectTarget(channelId);
    setConfirmOpen(true);
  };

  const handleDisconnectConfirm = async () => {
    if (!disconnectTarget) return;
    try {
      await disconnectMutation.mutateAsync({ channelId: disconnectTarget });
      setConfirmOpen(false);
      setDisconnectTarget(null);
    } catch (err: unknown) {
      // Disconnection failed (Requirement 9.5)
      const message =
        err && typeof err === 'object' && 'message' in err
          ? (err as { message: string }).message
          : 'The channel could not be disconnected. Please try again.';
      setDisconnectError(message);
      setConfirmOpen(false);
      setDisconnectTarget(null);
    }
  };

  const handleDisconnectCancel = () => {
    setConfirmOpen(false);
    setDisconnectTarget(null);
  };

  // --- Merge channel data with metadata ---

  function getChannelData(channelId: ChannelId): Channel | undefined {
    return channels?.find((ch) => ch.channelId === channelId);
  }

  // --- Loading state ---
  if (isLoading) {
    return (
      <div className="space-y-6">
        <h1 className="text-2xl font-bold text-gray-900">Channels</h1>
        <div className="grid grid-cols-1 gap-4 md:grid-cols-2 lg:grid-cols-3">
          {Array.from({ length: 6 }).map((_, i) => (
            <div
              key={i}
              className="h-40 animate-pulse rounded-lg border border-gray-200 bg-gray-100"
              aria-hidden="true"
            />
          ))}
        </div>
        <span className="sr-only">Loading channels...</span>
      </div>
    );
  }

  // --- Error state ---
  if (isError) {
    return (
      <div className="space-y-4">
        <h1 className="text-2xl font-bold text-gray-900">Channels</h1>
        <Alert variant="error" title="Unable to load channels">
          <p className="mt-1">
            Channel information is temporarily unavailable. Please try again.
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
        <h1 className="text-2xl font-bold text-gray-900">Channels</h1>
        <p className="text-sm text-gray-500">
          Manage your marketplace integrations
        </p>
      </div>

      {/* OAuth failure error (Requirement 9.3) */}
      {connectError && (
        <Alert
          variant="error"
          title="Connection Failed"
          dismissible
          onDismiss={() => setConnectError(null)}
        >
          {connectError}
        </Alert>
      )}

      {/* Disconnection failure error (Requirement 9.5) */}
      {disconnectError && (
        <Alert
          variant="error"
          title="Disconnection Failed"
          dismissible
          onDismiss={() => setDisconnectError(null)}
        >
          {disconnectError}
        </Alert>
      )}

      {/* Channel cards grid (Requirement 9.1) */}
      <div className="grid grid-cols-1 gap-4 md:grid-cols-2 lg:grid-cols-3">
        {CHANNEL_META.map((meta) => {
          const channelData = getChannelData(meta.channelId);
          const isConnected = channelData?.connected ?? false;

          return (
            <ChannelCard
              key={meta.channelId}
              meta={meta}
              channelData={channelData}
              isConnected={isConnected}
              isAdminOrAbove={isAdminOrAbove}
              isConnecting={
                connectMutation.isPending &&
                connectMutation.variables?.channelId === meta.channelId
              }
              onConnect={() => handleConnect(meta.channelId)}
              onDisconnect={() => handleDisconnectClick(meta.channelId)}
            />
          );
        })}
      </div>

      {/* Disconnect Confirmation Modal (Requirement 9.4) */}
      <ConfirmationModal
        open={confirmOpen}
        onOpenChange={setConfirmOpen}
        title="Disconnect Channel"
        description={`Are you sure you want to disconnect ${
          CHANNEL_META.find((m) => m.channelId === disconnectTarget)?.label ?? 'this channel'
        }? Products will no longer sync to this channel.`}
        confirmLabel="Disconnect"
        cancelLabel="Cancel"
        onConfirm={handleDisconnectConfirm}
        onCancel={handleDisconnectCancel}
        variant="danger"
        isLoading={disconnectMutation.isPending}
      />
    </div>
  );
}

// --- Channel Card Component ---

interface ChannelCardProps {
  meta: ChannelMeta;
  channelData: Channel | undefined;
  isConnected: boolean;
  isAdminOrAbove: boolean;
  isConnecting: boolean;
  onConnect: () => void;
  onDisconnect: () => void;
}

function ChannelCard({
  meta,
  channelData,
  isConnected,
  isAdminOrAbove,
  isConnecting,
  onConnect,
  onDisconnect,
}: ChannelCardProps) {
  const statusVariant: BadgeVariant = isConnected ? 'success' : 'neutral';
  const statusLabel = isConnected ? 'Connected' : 'Disconnected';

  return (
    <Card className="flex flex-col justify-between">
      <div>
        <div className="flex items-start justify-between">
          <div className="flex items-center gap-3">
            {meta.icon}
            <div>
              <h2 className="text-sm font-semibold text-gray-900">
                {meta.label}
              </h2>
              <p className="text-xs text-gray-500">{meta.description}</p>
            </div>
          </div>
          <Badge variant={statusVariant}>{statusLabel}</Badge>
        </div>

        {/* Connection details (Requirement 9.6) */}
        {isConnected && channelData && (
          <div className="mt-3 space-y-1 border-t border-gray-100 pt-3">
            {channelData.connectedAt && (
              <p className="text-xs text-gray-500">
                <span className="font-medium">Connected:</span>{' '}
                {new Date(channelData.connectedAt).toLocaleDateString()}
              </p>
            )}
            {channelData.shopUrl && (
              <p className="text-xs text-gray-500">
                <span className="font-medium">Shop URL:</span>{' '}
                <a
                  href={channelData.shopUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="text-blue-600 hover:underline"
                >
                  {channelData.shopUrl}
                </a>
              </p>
            )}
          </div>
        )}
      </div>

      {/* Action buttons (Requirement 9.2, 9.4) */}
      {isAdminOrAbove && (
        <div className="mt-4 border-t border-gray-100 pt-3">
          {isConnected ? (
            <button
              onClick={onDisconnect}
              className="w-full rounded-md border border-red-300 bg-white px-3 py-2 text-sm font-medium text-red-700 hover:bg-red-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-red-600 focus-visible:ring-offset-2"
            >
              Disconnect
            </button>
          ) : (
            <button
              onClick={onConnect}
              disabled={isConnecting}
              aria-busy={isConnecting}
              className="w-full rounded-md bg-blue-600 px-3 py-2 text-sm font-medium text-white hover:bg-blue-700 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-600 focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50"
            >
              {isConnecting ? (
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
                  Connecting…
                </span>
              ) : (
                'Connect'
              )}
            </button>
          )}
        </div>
      )}
    </Card>
  );
}
