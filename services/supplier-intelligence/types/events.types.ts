/**
 * EventBridge event types for the Supplier Intelligence Platform.
 * Source: "merch-os.supplier-intelligence"
 * Requirements: 1.5, 8.1, 8.2
 */

// ---------------------------------------------------------------------------
// Event Source Constant
// ---------------------------------------------------------------------------

export const SUPPLIER_INTELLIGENCE_EVENT_SOURCE = 'merch-os.supplier-intelligence' as const;

// ---------------------------------------------------------------------------
// Supplier Profile Changed Event
// ---------------------------------------------------------------------------

export interface SupplierProfileChangedEvent {
  source: typeof SUPPLIER_INTELLIGENCE_EVENT_SOURCE;
  'detail-type': 'SupplierProfileChanged';
  detail: {
    tenantId: string;
    supplierId: string;
    version: number;
    action: 'CREATED' | 'UPDATED';
  };
}

// ---------------------------------------------------------------------------
// Import Job Completed Event
// ---------------------------------------------------------------------------

export interface ImportJobCompletedEvent {
  source: typeof SUPPLIER_INTELLIGENCE_EVENT_SOURCE;
  'detail-type': 'ImportJobCompleted';
  detail: {
    tenantId: string;
    importJobId: string;
    supplierId: string;
    sourceType: string;
    results: {
      totalExtracted: number;
      created: number;
      updated: number;
      duplicates: number;
      validationFailed: number;
    };
    durationMs: number;
  };
}

// ---------------------------------------------------------------------------
// Import Job Failed Event
// ---------------------------------------------------------------------------

export interface ImportJobFailedEvent {
  source: typeof SUPPLIER_INTELLIGENCE_EVENT_SOURCE;
  'detail-type': 'ImportJobFailed';
  detail: {
    tenantId: string;
    importJobId: string;
    supplierId: string;
    error: {
      code: string;
      message: string;
    };
  };
}
