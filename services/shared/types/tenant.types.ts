/**
 * Tenant and organisation management interfaces for the MerchOS platform.
 * Requirements: 14.1, 14.2
 */

import { ChannelId, EventType, LanguageCode, NotificationChannel, PlanId } from './common.types';

/** Tenant account lifecycle status. */
export type TenantStatus = 'ACTIVE' | 'SUSPENDED' | 'DELETED';

/**
 * Configuration for a single outbound webhook endpoint.
 */
export interface WebhookConfig {
  /** UUID v4 */
  webhookId: string;
  /** HTTPS endpoint URL */
  url: string;
  /** HMAC signing secret for request verification */
  secret: string;
  /** Events that trigger this webhook */
  events: EventType[];
  active: boolean;
  /** ISO 8601 timestamp */
  createdAt: string;
}

/**
 * Connection details for a single channel integration (e.g. Shopify OAuth).
 */
export interface ChannelIntegration {
  channelId: ChannelId;
  connected: boolean;
  /** OAuth access token; stored encrypted in Secrets Manager */
  accessToken?: string;
  /** Shop URL for Shopify integrations */
  shopUrl?: string;
  /** ISO 8601 timestamp */
  connectedAt?: string;
}

/**
 * Tenant-level configuration settings.
 */
export interface TenantSettings {
  defaultLanguage: LanguageCode;
  webhooks: WebhookConfig[];
  /** Per-event notification delivery channel preferences */
  notificationPreferences: Partial<Record<EventType, NotificationChannel[]>>;
  /** Per-channel OAuth integration configurations */
  channelIntegrations: Partial<Record<ChannelId, ChannelIntegration>>;
}

/**
 * Top-level Tenant record.
 * DynamoDB: PK TENANT#<tenantId>, SK METADATA
 * Requirements: 1.1, 1.2, 1.8
 */
export interface Tenant {
  /** UUID v4 — globally unique identifier assigned at registration */
  tenantId: string;
  organisationName: string;
  contactEmail: string;
  plan: PlanId;
  status: TenantStatus;
  /** True when MFA is required for all users in this tenant */
  mfaRequired: boolean;
  /** True when SAML 2.0 federation is enabled (Enterprise plan only) */
  samlEnabled: boolean;
  /** ARN of the KMS key used for tenant-scoped data encryption */
  kmsKeyArn?: string;
  /** S3 prefix namespace scoped to this tenant: '{tenantId}/' */
  s3Prefix: string;
  /** Stripe customer ID for billing integration */
  stripeCustomerId: string;
  /** ISO 8601 timestamp */
  createdAt: string;
  /** ISO 8601 timestamp; set when tenant is suspended */
  suspendedAt?: string;
  /** ISO 8601 timestamp; set when tenant is deleted */
  deletedAt?: string;
  settings: TenantSettings;
}
