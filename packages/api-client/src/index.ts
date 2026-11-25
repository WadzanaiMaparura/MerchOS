// API Client package - React Query hooks + HTTP client
export { createApiClient } from './client';
export type { ApiClientConfig } from './client';
export { normalizeError, isApiError } from './errors';
export type { ApiError } from './errors';
export {
  ApiClientContext,
  useApiClient,
  IntelligenceClientContext,
  useIntelligenceClient,
  ExportClientContext,
  useExportClient,
  BillingClientContext,
  useBillingClient,
  ProductClientContext,
  useProductClient,
  SupplierClientContext,
  useSupplierClient,
  InventoryClientContext,
  useInventoryClient,
  ImageClientContext,
  useImageClient,
} from './context';

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
  useCancelAutoBilling,
  useBillingProfile,
  useUpdateBillingProfile,
  useInvoicePdf,
  billingKeys,
} from './hooks/useBilling';
export type {
  InvoiceListParams,
  PlanChangePayload,
  PlanChangeResult,
  UseBillingOptions,
  BillingProfile,
  BillingProfileInput,
  InvoicePdfResult,
} from './hooks/useBilling';

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
  useCanonicalProduct,
  useCreateProduct,
  useSynthesizeProduct,
  useRegenerateAttribute,
  useTrialUsage,
  trialKeys,
  applyListParams,
  MAX_LISTED_PRODUCTS,
} from './hooks/useProducts';
export type {
  CreateProductPayload,
  SynthesisType,
  SynthesizeResult,
  TrialUsage,
} from './hooks/useProducts';

// Product Intelligence (AI synthesis) hooks
export {
  useGenerateContent,
  GENERATION_LIMIT_REACHED,
  TRIAL_LIMIT_REACHED,
  TRIAL_NOT_ACTIVATED,
  isTrialErrorCode,
} from './hooks/useGenerateContent';
export type {
  GenerationType,
  GenerationMarketplaceId,
  GenerationProductData,
  GenerateContentPayload,
  GenerationResult,
} from './hooks/useGenerateContent';

// Image Intelligence Engine hooks (async image pipeline)
export {
  imageKeys,
  useRequestUploadUrl,
  useStartImageProcessing,
  useImageJob,
  useImageSignedUrl,
} from './hooks/useImageIntelligence';
export type {
  ImageJobStatus,
  ImageJob,
  ImageVariant,
  ImageModeration,
  UploadUrlResponse,
  SignedUrlResponse,
} from './hooks/useImageIntelligence';

// Admin Health hooks
export {
  adminHealthKeys,
  useHealthMetrics,
  useHealthSummary,
} from './hooks/useAdminHealth';
export type { TimeRange } from './hooks/useAdminHealth';

// Admin Tenants hooks
export {
  adminTenantKeys,
  useAdminTenants,
  useAdminTenantDetail,
  useSuspendTenant,
  useActivateTenant,
} from './hooks/useAdminTenants';
export type { TenantListParams } from './hooks/useAdminTenants';

// Admin Users hooks (Category 2 auth endpoints — ADR-005)
export {
  adminUserKeys,
  useAdminUsers,
  useInviteUser,
  useUpdateUserRole,
  useDisableUser,
  useDeleteUser,
} from './hooks/useAdminUsers';
export type {
  AdminUserSummary,
  ListUsersResponse,
  ListUsersParams,
  InviteUserPayload,
  InviteUserResponse,
  UpdateUserRolePayload,
  UpdateUserRoleResponse,
  DisableUserPayload,
  DeleteUserPayload,
} from './hooks/useAdminUsers';

// Admin Audit Log hooks
export {
  adminAuditKeys,
  useAuditLog,
} from './hooks/useAdminAuditLog';
export type { AuditListParams } from './hooks/useAdminAuditLog';

// Admin Alerts hooks
export {
  adminAlertKeys,
  useAlerts,
  useUnresolvedAlertCount,
  useResolveAlert,
} from './hooks/useAdminAlerts';
export type { AlertStatusFilter } from './hooks/useAdminAlerts';

// Admin Billing hooks
export {
  adminBillingKeys,
  useAdminBillingList,
  useAdminBillingDetail,
  usePlanOverride,
} from './hooks/useAdminBilling';
export type { AdminBillingListParams, SubscriptionStatus } from './hooks/useAdminBilling';

// Import Jobs hooks
export {
  importJobKeys,
  useImportJobs,
  useImportJobDetail,
} from './hooks/useImportJobs';
export type {
  ImportJobStatus,
  SourceType,
  ImportJobSummary,
  ImportJobDetail,
  FieldError,
  ImportJobListParams,
  ImportJobListResponse,
} from './hooks/useImportJobs';

// Supplier import triggers (direct-to-S3 uploads)
export { useStartFileImport, useImportFiles, useStartImageImport, useStartUrlImport, importContentType } from './hooks/useImportUpload';
export type { StartedImport } from './hooks/useImportUpload';

// Supplier hooks
export {
  supplierKeys,
  useSuppliers,
  useSupplierDetail,
  useSupplierVersions,
  useSupplierImports,
  useCreateSupplier,
  useUpdateSupplier,
} from './hooks/useSuppliers';
export type {
  DuplicateStrategy,
  SupplierSummary,
  SupplierVersion,
  SupplierListParams,
  SupplierListResponse,
  SupplierVersionsResponse,
  SupplierImportsParams,
  SupplierImportsResponse,
  CreateSupplierPayload,
  UpdateSupplierPayload,
} from './hooks/useSuppliers';

// Export / Validation (marketplace export pipeline) hooks
export {
  useValidateProduct,
  useGenerateExport,
  exportResultToBlob,
} from './hooks/useExport';
export type {
  ValidateProductPayload,
  GenerateExportPayload,
  GenerateExportResult,
  ExportFileResult,
  ExportArtifact,
  ExportProductItem,
  ExportOfferFields,
} from './hooks/useExport';

// Notifications
export { WebSocketManager } from './notifications/websocket-manager';
