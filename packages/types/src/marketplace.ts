/**
 * Marketplace schema, validation, and export type definitions for MerchOS.
 *
 * These types align with the Schema Registry & Validation Architecture
 * documented in docs/architecture/schema-validation-architecture.md.
 *
 * NOTE: These are TYPE DEFINITIONS ONLY — no application logic.
 */

import { ChannelId } from './common';

// ─── Verification & Classification Enums ─────────────────────────────────────

/** Tracks how a schema entry was verified against the source platform. */
export type VerificationStatus =
  | 'VERIFIED'
  | 'VERIFIED_FROM_TEMPLATE'
  | 'VERIFIED_FROM_PUBLIC_DOCUMENTATION'
  | 'REQUIRES_SELLER_ACCOUNT_VERIFICATION'
  | 'DRAFT'
  | 'DEPRECATED';

/** Classifies the authority level of a requirement. */
export type RequirementClassification =
  | 'OFFICIAL_REQUIREMENT'
  | 'OFFICIAL_RECOMMENDATION'
  | 'PLATFORM_BEHAVIOUR'
  | 'MERCHOS_BEST_PRACTICE'
  | 'INFERENCE'
  | 'UNVERIFIED';

// ─── Schema Registry Types ───────────────────────────────────────────────────

/** Supported export file formats. */
export type ExportFormat = 'CSV' | 'TSV' | 'XLSX' | 'JSON' | 'API';

/** Field requirement level within a schema. */
export type FieldRequirement = 'required' | 'conditional' | 'optional';

/** Data types supported in field definitions. */
export type FieldDataType =
  | 'string'
  | 'integer'
  | 'decimal'
  | 'boolean'
  | 'enum'
  | 'url'
  | 'date'
  | 'html';

/** A single field definition within a marketplace schema. */
export interface FieldDefinition {
  fieldId: string;
  platformFieldName: string;
  canonicalMapping: string | null;
  required: FieldRequirement;
  conditionExpression: string | null;
  dataType: FieldDataType;
  maxLength: number | null;
  minLength: number;
  allowedValues: string[] | null;
  pattern: string | null;
  minValue: number | null;
  maxValue: number | null;
  transformation: string | null;
  dependsOn: string[];
  requiredWith: string[];
  requirementClassification: RequirementClassification;
}

/** A complete schema entry in the Schema Registry. */
export interface MarketplaceSchema {
  // Identity
  platform: ChannelId;
  marketplace: string;
  categoryOrVertical: string;
  schemaId: string;
  schemaVersion: string;
  templateVersion: string | null;

  // Metadata
  sourceDocumentation: string[];
  dateVerified: string | null;
  verificationStatus: VerificationStatus;
  requirementClassification: RequirementClassification;
  notes: string | null;

  // Fields
  fields: FieldDefinition[];

  // Export format
  exportFormat: ExportFormat;
  columnOrder: string[];
  encoding: string;
  delimiter: string;
}

// ─── Validation Types ────────────────────────────────────────────────────────

/** Severity levels for validation findings. */
export type ValidationSeverity = 'ERROR' | 'WARNING' | 'INFO';

/** A single validation finding produced by the Validation Engine. */
export interface ValidationFinding {
  severity: ValidationSeverity;
  code: string;
  field: string;
  platformField: string;
  message: string;
  currentValue: unknown;
  expectedFormat: string | null;
  allowedValues: string[] | null;
  suggestion: string;
}

/** The complete validation report for a product against a target schema. */
export interface ValidationResult {
  productId: string;
  targetPlatform: ChannelId;
  targetCategory: string;
  schemaVersion: string;
  timestamp: string;
  exportAllowed: boolean;
  errorCount: number;
  warningCount: number;
  infoCount: number;
  findings: ValidationFinding[];
}

/** Export modes supported by the pipeline. */
export type ExportMode =
  | 'full-create'
  | 'offer-update'
  | 'inventory-sync'
  | 'price-update';

/** Request to validate a product against a marketplace schema. */
export interface ValidationRequest {
  productId: string;
  targetPlatform: ChannelId;
  targetCategory: string;
  exportMode: ExportMode;
  schemaVersion: string | 'latest';
}

// ─── Canonical Product Model (structural types) ──────────────────────────────

/** Core content data domain of the canonical product. */
export interface CanonicalContentData {
  title: string;
  shortDescription: string | null;
  longDescription: string | null;
  bulletPoints: string[];
  brand: string;
  manufacturer: string | null;
  sku: string;
  barcode: string | null;
  mpn: string | null;
  weight: number | null;
  weightUnit: 'g' | 'kg' | 'lb' | 'oz' | null;
  length: number | null;
  width: number | null;
  height: number | null;
  dimensionUnit: 'cm' | 'in' | 'mm' | null;
  materials: string[];
  attributes: Record<string, string | number | boolean>;
  imageRefs: CanonicalImageRef[];
  variants: CanonicalVariant[];
}

/** Image reference in the canonical model. */
export interface CanonicalImageRef {
  imageId: string;
  s3Key: string;
  position: number;
  altText: string | null;
  mimeType: string;
  width: number;
  height: number;
  fileSize: number;
  variantId: string | null;
}

/** A variant in the canonical model. */
export interface CanonicalVariant {
  variantId: string;
  sku: string;
  barcode: string | null;
  optionValues: Record<string, string>;
  priceOverride: number | null;
  stockOverride: number | null;
  imageRefs: CanonicalImageRef[];
}

/** Commercial/listing data domain. */
export interface CanonicalCommercialData {
  sellingPrice: number | null;
  rrp: number | null;
  salePrice: number | null;
  currency: string;
  stockQuantity: number;
  lowStockThreshold: number | null;
  fulfilmentMethod: string | null;
  leadtimeDays: number | null;
  handlingTimeDays: number | null;
  listingStatus: 'active' | 'draft' | 'archived';
  saleStartDate: string | null;
  saleEndDate: string | null;
}

/** Platform-specific data stored per marketplace. */
export interface PlatformSpecificData {
  platformIdentifiers: Partial<Record<ChannelId, string>>;
  categoryMappings: Partial<Record<ChannelId, string>>;
  metadata: Partial<Record<ChannelId, Record<string, unknown>>>;
  exportHistory: Partial<Record<ChannelId, ExportHistoryEntry>>;
}

/** Export history entry per platform. */
export interface ExportHistoryEntry {
  lastExportDate: string;
  lastExportVersion: string;
  exportStatus: 'success' | 'failed' | 'partial';
}

/**
 * The full canonical product model.
 *
 * This is the platform-independent representation that serves as the
 * single source of truth. No marketplace-specific fields leak into this model.
 * Platform adapters transform this into marketplace-specific formats.
 */
export interface CanonicalProduct {
  productId: string;
  tenantId: string;
  content: CanonicalContentData;
  commercial: CanonicalCommercialData;
  platformSpecific: PlatformSpecificData;
  lifecycleState: 'draft' | 'ready' | 'validated' | 'exported' | 'archived';
  createdAt: string;
  updatedAt: string;
}
