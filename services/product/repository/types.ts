import { CanonicalProduct } from '@merch-os/types';

export interface ListProductsOptions {
  limit?: number; // default 50, max 100
  nextToken?: string; // opaque pagination token
}

export interface PaginatedProducts {
  items: CanonicalProduct[];
  nextToken?: string;
}
