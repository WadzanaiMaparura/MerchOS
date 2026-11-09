import type {
  CanonicalProduct,
  EnrichmentLayer,
  LifecycleState,
  LifecycleTransition,
} from '@merch-os/types';

export interface ListProductsOptions {
  limit?: number; // default 50, max 100
  nextToken?: string; // opaque pagination token
}

export interface PaginatedProducts {
  items: CanonicalProduct[];
  nextToken?: string;
}

/**
 * The enrichment record persisted alongside a product (SK suffix #ENRICHMENT).
 *
 * Holds everything that lives in the `Product` DTO but NOT in the canonical
 * domain model: the AI enrichment layer, the lifecycle transition history, and
 * the precise UI lifecycle state (the canonical model only keeps the lossy
 * simplified subset — see services/product/service/lifecycle.ts).
 */
export interface ProductEnrichmentRecord {
  /** Precise external lifecycle state (authoritative for UI/API). */
  uiLifecycleState: LifecycleState;
  /** AI-generated enrichment layer (attributes + per-channel content). */
  enrichment: EnrichmentLayer;
  /** Ordered lifecycle transition audit trail. */
  lifecycleHistory: LifecycleTransition[];
  /** ISO timestamp of the last enrichment write. */
  updatedAt: string;
}
