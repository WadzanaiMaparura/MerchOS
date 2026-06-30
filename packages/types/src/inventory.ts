/**
 * Inventory-related DTOs for the MerchOS frontend.
 */

/** Summary representation of an inventory record for list views. */
export interface InventorySummary {
  sku: string;
  productId: string;
  productTitle: string;
  warehouseId: string;
  onHand: number;
  reserved: number;
  available: number;
  updatedAt: string; // ISO 8601
}

/** Payload to submit a manual stock adjustment. */
export interface StockAdjustmentPayload {
  sku: string;
  newQuantity: number;
  reason: string;
  source: string;
}
