/**
 * MerchOS Shared Types — barrel export
 *
 * Re-exports all canonical TypeScript interfaces and union types
 * used across the MerchOS platform services.
 *
 * Requirements: 14.1, 14.2
 */

// Common union types and primitives
export type {
  ChannelId,
  PlanId,
  LanguageCode,
  EventType,
  NotificationChannel,
} from './common.types';

// Product, Listing, and all related domain types
// (InventoryRecord is re-exported from inventory.types via product.types)
export type {
  LifecycleState,
  LifecycleTransition,
  ModerationStatus,
  ImageReference,
  EnrichmentSource,
  EnrichedAttribute,
  ChannelContent,
  LanguageContent,
  CategoryCandidate,
  CategoryMapping,
  ComplianceViolation,
  ComplianceReport,
  ExportRecord,
  InventoryRecord,
  Variant,
  EnrichmentLayer,
  Product,
  Listing,
} from './product.types';

// Tenant management types
export type {
  TenantStatus,
  WebhookConfig,
  ChannelIntegration,
  TenantSettings,
  Tenant,
} from './tenant.types';

// Inventory management types
export type {
  InventoryTransactionSource,
  InventoryTransaction,
} from './inventory.types';

// Billing and subscription types
export type {
  SubscriptionStatus,
  BillingCycle,
  Subscription,
  UsageRecord,
  PlanLimits,
  Invoice,
} from './billing.types';
