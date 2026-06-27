/**
 * Common union types and shared primitives used across the MerchOS platform.
 * Requirements: 14.1, 14.2
 */

/** Supported sales channel identifiers */
export type ChannelId =
  | 'takealot'
  | 'amazon'
  | 'makro'
  | 'shopify'
  | 'woocommerce'
  | 'custom';

/** Subscription plan identifiers */
export type PlanId = 'starter' | 'growth' | 'professional' | 'enterprise';

/** Supported ISO 639-1 language codes */
export type LanguageCode = 'en' | 'af' | 'fr' | 'de' | 'es' | 'pt' | 'zh' | 'ar';

/** Platform event types emitted to EventBridge */
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

/** Notification delivery channels for tenant alerts */
export type NotificationChannel = 'in-app' | 'email' | 'webhook';
