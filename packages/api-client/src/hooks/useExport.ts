'use client';

import { useMutation, UseMutationResult } from '@tanstack/react-query';
import type { CanonicalProduct, ValidationResult, ExportMode } from '@merch-os/types';
import type { ApiError } from '../errors';
import { useExportClient } from '../context';

// ─── Validate ────────────────────────────────────────────────────────────────

/** Request body for POST /validate. */
export interface ValidateProductPayload {
  product: CanonicalProduct;
  /** Explicit Takealot loadsheet template id; resolved from category otherwise. */
  templateId?: string;
  /** Resolved category display values (optional; parsed from product otherwise). */
  topCategory?: string;
  category?: string;
}

/**
 * Validate a canonical product against its target Takealot schema.
 * Returns a deterministic ValidationResult; `exportAllowed` is the hard gate.
 */
export function useValidateProduct(): UseMutationResult<
  ValidationResult,
  ApiError,
  ValidateProductPayload
> {
  const client = useExportClient();

  return useMutation<ValidationResult, ApiError, ValidateProductPayload>({
    mutationFn: async (payload) => {
      const response = await client.post<{ result: ValidationResult }>(
        '/validate',
        payload
      );
      return response.data.result;
    },
  });
}

// ─── Export ──────────────────────────────────────────────────────────────────

/** Offer-level overrides for offer/stock/price export modes. */
export interface ExportOfferFields {
  stockOnHand?: number;
  sellingPrice?: number;
  rrp?: number;
  leadtimeDays?: number;
}

/** A single product entry in an export request. */
export interface ExportProductItem {
  product: CanonicalProduct;
  topCategory?: string;
  category?: string;
  offer?: ExportOfferFields;
}

/** Request body for POST /export. */
export interface GenerateExportPayload {
  products: ExportProductItem[];
  mode: ExportMode;
  /** Output format. Defaults to CSV; XLSX for native product-creation loadsheets. */
  format?: 'CSV' | 'XLSX';
  templateId?: string;
  /** Export passing products and report failures instead of blocking the batch. */
  partial?: boolean;
  /** Request S3 delivery; returns a signed download URL in `artifact`. */
  delivery?: { tenantId: string; exportId: string; expiresInSeconds?: number };
}

/** The export file + metadata returned by POST /export. */
export interface ExportFileResult {
  format: 'CSV' | 'XLSX';
  filename: string;
  /** CSV: utf-8 text. XLSX: base64-encoded bytes (see `encoding`). */
  content: string;
  encoding: 'utf-8' | 'base64';
  rowCount: number;
  columns: string[];
}

/** Signed-download artifact when delivery was requested. */
export interface ExportArtifact {
  key: string;
  downloadUrl: string;
  expiresInSeconds: number;
  bucket: string;
}

/** Full POST /export response. */
export interface GenerateExportResult {
  export: ExportFileResult;
  artifact: ExportArtifact | null;
  validatedCount: number;
  excludedCount: number;
  excluded: ValidationResult[];
}

/**
 * Generate a marketplace export file from validated products. The service runs
 * validation as a hard gate first; a 409 EXPORT_BLOCKED means one or more
 * products failed validation (and `partial` was not set).
 */
export function useGenerateExport(): UseMutationResult<
  GenerateExportResult,
  ApiError,
  GenerateExportPayload
> {
  const client = useExportClient();

  return useMutation<GenerateExportResult, ApiError, GenerateExportPayload>({
    mutationFn: async (payload) => {
      const response = await client.post<GenerateExportResult>('/export', payload);
      return response.data;
    },
  });
}

/**
 * Turn an ExportFileResult into a Blob suitable for a browser download.
 * Decodes base64 for XLSX; passes CSV text through.
 */
export function exportResultToBlob(result: ExportFileResult): Blob {
  if (result.encoding === 'base64') {
    const binary = atob(result.content);
    const bytes = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
    return new Blob([bytes], {
      type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    });
  }
  return new Blob([result.content], { type: 'text/csv;charset=utf-8' });
}
