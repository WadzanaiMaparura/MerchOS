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

/**
 * Payload to submit a manual stock adjustment.
 *
 * `newQuantity` is the ABSOLUTE target on-hand value (not a delta). The
 * deployed `PUT /inventory/{sku}` contract takes an absolute `onHand`, so the
 * form computes `onHand = currentOnHand + delta` before submitting.
 *
 * Note: `reason` and `source` are captured for the UI but are NOT persisted by
 * the current backend route — `PUT /inventory/{sku}` has no field for them and
 * derives the delta/actor server-side from the absolute value and the JWT.
 */
export interface StockAdjustmentPayload {
  sku: string;
  warehouseId: string;
  newQuantity: number;
  reason: string;
  source: string;
}
