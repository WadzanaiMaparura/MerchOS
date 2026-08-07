/**
 * Supplier Intelligence domain types — supplier profiles, import jobs, and related models.
 * Requirements: 1.1, 2.1, 5.5, 7.1, 8.1
 */

// ---------------------------------------------------------------------------
// Enums / Union Types
// ---------------------------------------------------------------------------

/**
 * Source type of an import job, indicating how product data was provided.
 */
export type SourceType =
  | 'FILE_CSV'
  | 'FILE_EXCEL'
  | 'FILE_PDF'
  | 'FILE_ZIP'
  | 'IMAGE'
  | 'URL';

/**
 * Valid statuses for an import job throughout its lifecycle.
 * Valid transitions: QUEUED → PROCESSING → VALIDATING → PERSISTING → COMPLETED,
 * or from any active state → FAILED.
 */
export type ImportJobStatus =
  | 'QUEUED'
  | 'PROCESSING'
  | 'VALIDATING'
  | 'PERSISTING'
  | 'COMPLETED'
  | 'FAILED';

/**
 * Strategy for handling duplicate products detected during import.
 * - SKIP: Do not create a new record for the duplicate
 * - MERGE: Update the existing record with changed fields
 * - CREATE_FLAGGED: Create a new record with a `duplicateOf` flag
 */
export type DuplicateStrategy = 'SKIP' | 'MERGE' | 'CREATE_FLAGGED';

// ---------------------------------------------------------------------------
// Supplier Profile
// ---------------------------------------------------------------------------

/**
 * A tenant-scoped supplier profile record.
 * Stored in DynamoDB: PK TENANT#{tenantId}, SK SUPPLIER#{supplierId}.
 */
export interface SupplierProfile {
  supplierId: string;
  tenantId: string;
  name: string;
  contactEmail?: string;
  contactPhone?: string;
  website?: string;
  notes?: string;
  duplicateStrategy: DuplicateStrategy;
  version: number;
  /** ISO 8601 timestamp */
  createdAt: string;
  /** ISO 8601 timestamp */
  updatedAt: string;
}

/**
 * A historical snapshot of a supplier profile at a specific version.
 * Stored as SK: SUPPLIER#{supplierId}#VERSION#{version}.
 */
export interface SupplierVersion {
  supplierId: string;
  tenantId: string;
  version: number;
  snapshot: SupplierProfile;
  /** ISO 8601 timestamp of when this version was created */
  createdAt: string;
}

// ---------------------------------------------------------------------------
// Import Job
// ---------------------------------------------------------------------------

/** Real-time progress metadata for an in-flight import job. */
export interface ImportJobProgress {
  percentage: number;
  currentStep: string;
  estimatedTimeRemaining?: number;
}

/** Summary results of a completed import job. */
export interface ImportJobResults {
  totalExtracted: number;
  created: number;
  updated: number;
  duplicates: number;
  validationFailed: number;
}

/** An error entry recorded during import processing. */
export interface ImportJobError {
  code: string;
  message: string;
  field?: string;
  recordIndex?: number;
}

/**
 * An import job record representing a single unit of data ingestion work.
 * Stored in DynamoDB: PK TENANT#{tenantId}, SK IMPORT#{importJobId}.
 */
export interface ImportJob {
  importJobId: string;
  tenantId: string;
  supplierId: string;
  sourceType: SourceType;
  sourceReference: string;
  status: ImportJobStatus;
  stepFunctionExecutionArn?: string;
  progress?: ImportJobProgress;
  results?: ImportJobResults;
  errors: ImportJobError[];
  crawlStats?: ImportCrawlStats;
  validationSummary?: ImportValidationSummary;
  /** ISO 8601 timestamp */
  startedAt?: string;
  /** ISO 8601 timestamp */
  completedAt?: string;
  /** ISO 8601 timestamp */
  createdAt: string;
  /** Unix timestamp — TTL for DynamoDB auto-expiry (365 days from creation) */
  ttl: number;
}

/** Crawl statistics recorded on URL-based import jobs. */
export interface ImportCrawlStats {
  pagesCrawled: number;
  pagesSkipped: number;
  productsExtracted: number;
  imagesDownloaded: number;
  errorsEncountered: number;
  durationMs: number;
}

/** Validation summary stored on an import job after the validation step. */
export interface ImportValidationSummary {
  totalRecords: number;
  passed: number;
  failed: number;
  fieldErrorCounts: Record<string, number>;
}

// ---------------------------------------------------------------------------
// Import Metadata (attached to Product records)
// ---------------------------------------------------------------------------

/**
 * Provenance metadata attached to Product records created via import.
 * Stored as `attributes.importMetadata` on the Product record.
 */
export interface ImportMetadata {
  sourceImportJobId: string;
  sourceSupplierId: string;
  sourceType: SourceType;
  /** ISO 8601 timestamp */
  importedAt: string;
  /** Confidence score for image-based imports (0.0 - 1.0) */
  ocrConfidence?: number;
  /** True when OCR confidence < 0.70, requiring manual review */
  flaggedForReview?: boolean;
  /** Product ID of the existing record this is a potential duplicate of */
  duplicateOf?: string;
}
