/**
 * @merch-os/types — Shared TypeScript types for MerchOS frontend applications.
 *
 * Organized by domain and re-exported from this barrel file.
 */

// Common enumerations and union types
export type {
  LifecycleState,
  SellerRole,
  ChannelId,
  PlanId,
  TenantStatus,
  EventType,
} from './common';

// Product DTOs
export type {
  ProductSummary,
  Product,
  PaginatedResponse,
  ProductListParams,
  ApproveAttributePayload,
  OverrideAttributePayload,
  TransitionPayload,
  ModerationStatus,
  ImageReference,
  EnrichedAttribute,
  EnrichmentLayer,
  ComplianceReport,
  CategoryMapping,
  Variant,
  ChannelContent,
  ComplianceViolation,
  LifecycleTransition,
} from './product';

// Inventory DTOs
export type {
  InventorySummary,
  StockAdjustmentPayload,
} from './inventory';

// Billing DTOs
export type {
  SubscriptionStatus,
  BillingCycle,
  PlanLimits,
  UsageMeters,
  BillingOverview,
  InvoiceStatus,
  InvoiceSummary,
} from './billing';

// Export DTOs
export type {
  ExportSummary,
  TriggerExportPayload,
} from './export';

// Notification types
export type {
  Notification,
  WebSocketManagerConfig,
} from './notification';

// Auth types
export type {
  AuthUser,
  AuthState,
  MfaChallengeResult,
  AuthContextValue,
} from './auth';
