/** POST /products request body */
export interface CreateProductRequest {
  title: string;
  sku: string;
  brand: string;
  shortDescription?: string;
  longDescription?: string;
  bulletPoints?: string[];
  manufacturer?: string;
  barcode?: string;
  mpn?: string;
  weight?: number;
  weightUnit?: 'g' | 'kg' | 'lb' | 'oz';
  length?: number;
  width?: number;
  height?: number;
  dimensionUnit?: 'cm' | 'in' | 'mm';
  materials?: string[];
  attributes?: Record<string, string | number | boolean>;
  stockQuantity?: number;
  fulfilmentMethod?: string;
  leadtimeDays?: number;
}

/** PUT /products/{productId} request body */
export interface UpdateProductRequest {
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
  stockQuantity?: number;
  lowStockThreshold?: number | null;
  fulfilmentMethod?: string | null;
  leadtimeDays?: number | null;
  handlingTimeDays?: number | null;
  listingStatus?: 'active' | 'draft';
}

/** GET /products query parameters */
export interface ListProductsQuery {
  limit?: string;
  nextToken?: string;
}

/** Standard success response wrapper */
export interface ProductResponse {
  product: Record<string, unknown>;
}

/** List response with pagination */
export interface ProductListResponse {
  products: Record<string, unknown>[];
  nextToken?: string;
}

/** Standard error response */
export interface ErrorResponse {
  error: {
    code: string;
    message: string;
    field?: string;
  };
}
