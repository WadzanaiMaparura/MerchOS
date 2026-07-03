/**
 * Admin Dashboard DTOs and types for the MerchOS platform operator interface.
 */

import type { PlanId } from './common';
import type { InvoiceSummary, SubscriptionStatus } from './billing';

// Re-export SubscriptionStatus for convenience in admin contexts
export type { SubscriptionStatus } from './billing';

/** Authenticated admin operator. */
export interface AdminUser {
  userId: string;
  email: string;
  role: 'operator';
}

/** Tenant status in the admin context (lowercase wire format). */
export type AdminTenantStatus = 'active' | 'suspended';

/** Summary representation of a tenant for list views. */
export interface TenantSummary {
  tenantId: string;
  name: string;
  plan: PlanId;
  status: AdminTenantStatus;
  userCount: number;
  productCount: number;
  registeredAt: string; // ISO 8601
}

/** Full tenant detail including last activity. */
export interface TenantDetail extends TenantSummary {
  lastActivityAt: string; // ISO 8601
}

/** Payload for suspending a tenant. */
export interface SuspendTenantPayload {
  tenantId: string;
  reason: string; // 1-500 characters
}

/** Payload for activating a suspended tenant. */
export interface ActivateTenantPayload {
  tenantId: string;
}

/** A single data point in a metric time series. */
export interface MetricDatapoint {
  timestamp: string; // ISO 8601
  value: number;
}

/** A named time series of metric data points. */
export interface MetricSeries {
  name: string;
  datapoints: MetricDatapoint[];
  unit: string;
}

/** Health metrics containing all infrastructure metric series. */
export interface HealthMetrics {
  lambdaErrorRates: MetricSeries[];
  stepFunctionsFailures: MetricSeries[];
  sqsQueueDepths: MetricSeries[];
  dynamoConsumedCapacity: MetricSeries[];
}

/** Summary health numbers for the platform. */
export interface HealthSummary {
  activeTenantCount: number;
  productsProcessedToday: number;
}

/** Summary of a compliance channel for list views. */
export interface ComplianceChannelSummary {
  channelId: string;
  channelName: string;
  version: string;
  updatedAt: string; // ISO 8601
}

/** Full compliance rule set including schema and current values. */
export interface ComplianceRuleSet {
  channelId: string;
  channelName: string;
  version: string;
  updatedAt: string;
  rules: Record<string, unknown>;
  jsonSchema: Record<string, unknown>;
}

/** Payload for saving compliance rules. */
export interface SaveCompliancePayload {
  channelId: string;
  rules: Record<string, unknown>;
}

/** Taxonomy status values. */
export type TaxonomyStatusValue = 'CURRENT' | 'STALE' | 'REFRESHING';

/** Channel taxonomy status information. */
export interface TaxonomyStatus {
  channelId: string;
  channelName: string;
  version: string;
  lastRefreshDate: string; // ISO 8601
  nodeCount: number;
  status: TaxonomyStatusValue;
}

/** A single audit event record. */
export interface AuditEvent {
  eventId: string;
  timestamp: string; // ISO 8601
  actor: string; // email or system identifier
  actionType: string;
  resource: string;
  tenantId?: string;
  details: Record<string, unknown>;
}

/** Parameters for querying the audit log. */
export interface AuditListParams {
  page?: number;
  pageSize?: number; // default: 50
  search?: string;
  startDate?: string; // ISO 8601
  endDate?: string; // ISO 8601
  actionType?: string;
}

/** An alert item representing a Lambda error rate alert. */
export interface AlertItem {
  alertId: string;
  functionName: string;
  currentErrorRate: number; // percentage 0-100
  errorCount: number;
  triggeredAt: string; // ISO 8601
  resolved: boolean;
  resolvedAt?: string;
  resolutionNote?: string;
}

/** Payload for resolving an alert. */
export interface ResolveAlertPayload {
  alertId: string;
  note: string; // 1-1000 characters
}

/** Filter values for alert status. */
export type AlertStatusFilter = 'all' | 'unresolved' | 'resolved';

/** Summary of a tenant's billing for list views. */
export interface AdminBillingSummary {
  tenantId: string;
  tenantName: string;
  plan: PlanId;
  billingCycle: 'monthly' | 'annual';
  status: SubscriptionStatus;
  currentPeriodEnd: string; // ISO 8601
}

/** Full billing detail for a tenant including usage and invoices. */
export interface AdminBillingDetail extends AdminBillingSummary {
  usage: {
    enrichmentCalls: number;
    enrichmentLimit: number;
    imageCalls: number;
    imageLimit: number;
    csvExports: number;
    csvExportLimit: number;
  };
  recentInvoices: InvoiceSummary[];
}

/** Payload for overriding a tenant's subscription plan. */
export interface PlanOverridePayload {
  tenantId: string;
  targetPlan: PlanId;
  reason: string; // 1-500 characters
}

/** Time range selector values for health metric queries. */
export type TimeRange = '1h' | '6h' | '24h' | '7d';

/** Parameters for querying the admin billing list. */
export interface AdminBillingListParams {
  page?: number;
  pageSize?: number; // default: 25
  search?: string;
  status?: SubscriptionStatus;
}
