/**
 * Input/output types for the ProductService layer.
 */

/** Input for creating a new product. */
export interface CreateProductInput {
  /** Product title (required) */
  title: string;
  /** Seller-defined SKU (required, must be unique within tenant) */
  sku: string;
  /** Brand name (required) */
  brand: string;
  /** Short description */
  shortDescription?: string;
  /** Long description */
  longDescription?: string;
  /** Bullet points */
  bulletPoints?: string[];
  /** Manufacturer */
  manufacturer?: string;
  /** Barcode (EAN/UPC/GTIN) */
  barcode?: string;
  /** Manufacturer part number */
  mpn?: string;
  /** Weight */
  weight?: number;
  weightUnit?: 'g' | 'kg' | 'lb' | 'oz';
  /** Dimensions */
  length?: number;
  width?: number;
  height?: number;
  dimensionUnit?: 'cm' | 'in' | 'mm';
  /** Materials */
  materials?: string[];
  /** Custom attributes */
  attributes?: Record<string, string | number | boolean>;
  /** Commercial data */
  sellingPrice?: number;
  rrp?: number;
  currency?: string;
  stockQuantity?: number;
  fulfilmentMethod?: string;
  leadtimeDays?: number;
}

/** Input for updating an existing product (all fields optional). */
export interface UpdateProductInput {
  title?: string;
  sku?: string;
  brand?: string;
  shortDescription?: string | null;
  longDescription?: string | null;
  bulletPoints?: string[];
  manufacturer?: string | null;
  barcode?: string | null;
  mpn?: string | null;
  weight?: number | null;
  weightUnit?: 'g' | 'kg' | 'lb' | 'oz' | null;
  length?: number | null;
  width?: number | null;
  height?: number | null;
  dimensionUnit?: 'cm' | 'in' | 'mm' | null;
  materials?: string[];
  attributes?: Record<string, string | number | boolean>;
  sellingPrice?: number | null;
  rrp?: number | null;
  salePrice?: number | null;
  currency?: string;
  stockQuantity?: number;
  lowStockThreshold?: number | null;
  fulfilmentMethod?: string | null;
  leadtimeDays?: number | null;
  handlingTimeDays?: number | null;
  listingStatus?: 'active' | 'draft' | 'archived';
}
