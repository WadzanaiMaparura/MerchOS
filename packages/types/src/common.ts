/**
 * Common union types and shared primitives for the MerchOS frontend.
 * These mirror the backend common.types.ts wire format.
 */

/** Valid states in the product lifecycle state machine. */
export type LifecycleState =
  | 'DRAFT'
  | 'INGESTED'
  | 'ENRICHED'
  | 'REVIEW'
  | 'VALIDATED'
  | 'EXPORT_READY'
  | 'PUBLISHED'
  | 'ARCHIVED';

/** Seller user roles within a tenant. */
export type SellerRole = 'owner' | 'admin' | 'editor' | 'viewer';

/** Supported sales channel identifiers. */
export type ChannelId =
  | 'takealot'
  | 'amazon'
  | 'makro'
  | 'shopify'
  | 'woocommerce'
  | 'custom';

/** Subscription plan identifiers. */
export type PlanId = 'starter' | 'growth' | 'professional' | 'enterprise';

/** Tenant account lifecycle status. */
export type TenantStatus = 'ACTIVE' | 'SUSPENDED' | 'DELETED';

/** Platform event types emitted to EventBridge. */
export type EventType =
  | 'tenant.created'
  | 'tenant.suspended'
  | 'tenant.reactivated'
  | 'tenant.deleted'
  | 'product.ingested'
  | 'product.enriched'
  | 'product.review_required'
  | 'product.validated'
  | 'product.exported'
  | 'inventory.updated'
  | 'inventory.stockout'
  | 'compliance.passed'
  | 'compliance.failed'
  | 'compliance.rules_updated'
  | 'listing.published'
  | 'taxonomy.refresh_complete'
  | 'ingestion.failed'
  | 'image.moderation_rejected'
  | 'billing.payment_succeeded'
  | 'billing.payment_failed'
  | 'billing.usage_limit_reached';
