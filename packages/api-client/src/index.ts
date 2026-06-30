// API Client package - React Query hooks + HTTP client
export { createApiClient } from './client';
export type { ApiClientConfig } from './client';
export { normalizeError, isApiError } from './errors';
export type { ApiError } from './errors';
export { ApiClientContext, useApiClient } from './context';

// Inventory hooks
export {
  useInventory,
  useStockAdjustment,
  useTransactionHistory,
  inventoryKeys,
} from './hooks/useInventory';
export type {
  InventoryListParams,
  TransactionHistoryParams,
  InventoryTransaction,
} from './hooks/useInventory';

// Billing hooks
export {
  useBilling,
  useInvoices,
  usePlanChange,
  billingKeys,
} from './hooks/useBilling';
export type { InvoiceListParams, PlanChangePayload } from './hooks/useBilling';

// Channels hooks
export {
  useChannels,
  useConnectChannel,
  useDisconnectChannel,
  channelKeys,
} from './hooks/useChannels';
export type {
  Channel,
  ConnectChannelPayload,
  ConnectChannelResult,
  DisconnectChannelPayload,
} from './hooks/useChannels';

// Team hooks
export {
  useTeamMembers,
  useInviteMember,
  useChangeRole,
  useRemoveMember,
  teamKeys,
} from './hooks/useTeam';
export type {
  TeamMember,
  InviteMemberPayload,
  ChangeRolePayload,
  RemoveMemberPayload,
} from './hooks/useTeam';

// Webhook hooks
export {
  useWebhooks,
  useCreateWebhook,
  useToggleWebhook,
  useDeleteWebhook,
  webhookKeys,
} from './hooks/useWebhooks';
export type {
  Webhook,
  CreateWebhookPayload,
  ToggleWebhookPayload,
  DeleteWebhookPayload,
} from './hooks/useWebhooks';

// Product domain hooks
export {
  productKeys,
  useProducts,
  useProduct,
  useUpdateProduct,
  useApproveAttribute,
  useOverrideAttribute,
  useTransitionLifecycle,
  useProductSearch,
  useProductExport,
  useProductUpload,
  useImageUpload,
  useSetHeroImage,
} from './hooks/useProducts';

// Notifications
export { WebSocketManager } from './notifications/websocket-manager';
