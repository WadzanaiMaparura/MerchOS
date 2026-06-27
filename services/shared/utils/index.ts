/**
 * MerchOS Shared Utilities — barrel export
 */

export {
  // Table constants
  TENANTS_TABLE,
  PRODUCTS_TABLE,
  INVENTORY_TABLE,
  INVENTORY_TRANSACTIONS_TABLE,
  BILLING_TABLE,
  AUDIT_LOG_TABLE,
  COMPLIANCE_RULES_TABLE,
  // Key helpers
  tenantPK,
  productSK,
  userSK,
  auditSK,
  inventorySK,
  transactionSK,
  subscriptionSK,
  usageSK,
  invoiceSK,
  // Error class
  TenantIsolationError,
  // Client class and factory
  TenantDynamoClient,
  createTenantDynamoClient,
} from './dynamo-client';

export { writeAuditLog, writeLifecycleAuditLog } from './audit-log';
export type { AuditAction, AuditLogEntry, WriteAuditLogInput } from './audit-log';
