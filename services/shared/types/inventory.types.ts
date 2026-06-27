/**
 * Inventory management interfaces for the MerchOS platform.
 * Requirements: 14.1, 14.2
 */

/** Sources from which an inventory transaction can originate. */
export type InventoryTransactionSource =
  | 'manual'
  | 'csv-import'
  | 'api'
  | 'whatsapp'
  | 'feed'
  | 'order'
  | 'cancellation';

/**
 * Current stock record for a SKU in a specific warehouse.
 * DynamoDB: PK TENANT#<tenantId>, SK SKU#<sku>#WAREHOUSE#<warehouseId>
 */
export interface InventoryRecord {
  tenantId: string;
  sku: string;
  warehouseId: string;
  onHand: number;
  reserved: number;
  /** Derived: onHand - reserved */
  available: number;
  /** ISO 8601 timestamp */
  updatedAt: string;
}

/**
 * Immutable ledger entry recording a stock quantity change.
 * DynamoDB: PK TENANT#<tenantId>, SK TXN#<timestamp>#<txnId>
 */
export interface InventoryTransaction {
  tenantId: string;
  /** UUID v4 */
  txnId: string;
  sku: string;
  warehouseId: string;
  /** Actor who initiated the change (user ID or system service identifier) */
  actor: string;
  source: InventoryTransactionSource;
  /** Positive = stock increase, negative = stock decrease */
  deltaQty: number;
  previousQty: number;
  newQty: number;
  /** Associated order ID, if applicable */
  orderId?: string;
  /** ISO 8601 timestamp */
  timestamp: string;
}
