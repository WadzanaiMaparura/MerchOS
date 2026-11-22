'use client';

import React, { useState, useCallback, useEffect } from 'react';
import Link from 'next/link';
import { useImportFiles, useSuppliers, useCreateSupplier } from '@merch-os/api-client';
import { Modal, FileUpload, Alert, Select } from '@merch-os/ui';
import { describeProductError } from '../../../components/TrialBanner';

const MAX_FILE_SIZE = 10 * 1024 * 1024; // 10 MB
const MAX_ROWS = 10_000;
// What the import engine needs per row (services/supplier-intelligence
// validation): a title and a SKU, plus a description or an image.
const REQUIRED_HEADERS = ['sku', 'title'];
const MAX_ERRORS_DISPLAYED = 50;
/** Created on first use when the seller has no supplier yet. */
const DEFAULT_SUPPLIER_NAME = 'My catalogue';
const NEW_SUPPLIER = '__new__';

interface CSVValidationError {
  row: number;
  message: string;
}

interface CSVUploadModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

/**
 * CSVUploadModal - Modal for CSV product upload with client-side validation.
 * Validates: file size ≤ 10 MB, required headers (SKU, title, brand), max 10,000 rows.
 * Displays validation errors with row numbers (up to first 50 errors).
 * Requirements: 5.9, 5.10
 */
export function CSVUploadModal({ open, onOpenChange }: CSVUploadModalProps) {
  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const [validationErrors, setValidationErrors] = useState<CSVValidationError[]>([]);
  const [isValidating, setIsValidating] = useState(false);
  const [uploadSuccess, setUploadSuccess] = useState(false);
  const [importJobId, setImportJobId] = useState<string | null>(null);
  const [supplierChoice, setSupplierChoice] = useState<string>('');
  const [uploadError, setUploadError] = useState<string | null>(null);

  // Imports belong to a supplier (it holds the duplicate-handling rule).
  const suppliersQuery = useSuppliers({ limit: 100 });
  const suppliers = suppliersQuery.data?.suppliers ?? [];
  const createSupplier = useCreateSupplier();
  const importFiles = useImportFiles();
  const isUploading = createSupplier.isPending || importFiles.isPending;

  useEffect(() => {
    if (supplierChoice || suppliersQuery.isLoading) return;
    setSupplierChoice(suppliers[0]?.supplierId ?? NEW_SUPPLIER);
  }, [suppliers, supplierChoice, suppliersQuery.isLoading]);

  const resetState = useCallback(() => {
    setSelectedFile(null);
    setValidationErrors([]);
    setIsValidating(false);
    setUploadSuccess(false);
    setImportJobId(null);
    setUploadError(null);
    importFiles.reset();
  }, [importFiles]);

  const handleClose = useCallback(
    (isOpen: boolean) => {
      if (!isOpen) {
        resetState();
      }
      onOpenChange(isOpen);
    },
    [onOpenChange, resetState]
  );

  const parseCSVHeaders = (firstLine: string): string[] => {
    return firstLine
      .split(',')
      .map((h) => h.trim().toLowerCase().replace(/^["']|["']$/g, ''));
  };

  const validateCSV = useCallback(
    async (file: File): Promise<CSVValidationError[]> => {
      const errors: CSVValidationError[] = [];

      const text = await file.text();
      const lines = text.split(/\r?\n/).filter((line) => line.trim().length > 0);

      if (lines.length === 0) {
        errors.push({ row: 0, message: 'File is empty' });
        return errors;
      }

      // Validate headers (row 1)
      const headers = parseCSVHeaders(lines[0]!);
      const missingHeaders = REQUIRED_HEADERS.filter(
        (required) => !headers.includes(required)
      );

      if (missingHeaders.length > 0) {
        errors.push({
          row: 1,
          message: `Missing required headers: ${missingHeaders.join(', ')}`,
        });
      }

      // Validate row count (excluding header)
      const dataRows = lines.length - 1;
      if (dataRows > MAX_ROWS) {
        errors.push({
          row: 0,
          message: `File contains ${dataRows.toLocaleString()} data rows, exceeding the maximum of ${MAX_ROWS.toLocaleString()} rows`,
        });
      }

      // Validate individual rows have required fields
      if (missingHeaders.length === 0 && dataRows > 0) {
        const skuIndex = headers.indexOf('sku');
        const titleIndex = headers.indexOf('title');

        for (let i = 1; i < lines.length && errors.length < MAX_ERRORS_DISPLAYED; i++) {
          const fields = parseCSVRow(lines[i]!);
          const rowNum = i + 1; // 1-indexed, accounting for header

          if (skuIndex >= 0 && (!fields[skuIndex] || fields[skuIndex]!.trim() === '')) {
            errors.push({ row: rowNum, message: 'SKU is required' });
          }
          if (titleIndex >= 0 && (!fields[titleIndex] || fields[titleIndex]!.trim() === '')) {
            errors.push({ row: rowNum, message: 'Title is required' });
          }

          if (errors.length >= MAX_ERRORS_DISPLAYED) break;
        }
      }

      return errors.slice(0, MAX_ERRORS_DISPLAYED);
    },
    []
  );

  const handleFileSelected = useCallback(
    async (files: File[]) => {
      const file = files[0];
      if (!file) return;

      setSelectedFile(file);
      setValidationErrors([]);
      setUploadSuccess(false);
      setUploadError(null);
      importFiles.reset();
      setIsValidating(true);

      try {
        const errors = await validateCSV(file);
        setValidationErrors(errors);
      } catch {
        setValidationErrors([{ row: 0, message: 'Failed to read file contents' }]);
      } finally {
        setIsValidating(false);
      }
    },
    [validateCSV, importFiles]
  );

  const handleUpload = useCallback(async () => {
    if (!selectedFile || validationErrors.length > 0) return;
    setUploadError(null);
    try {
      let supplierId = supplierChoice;
      if (!supplierId || supplierId === NEW_SUPPLIER) {
        const created = (await createSupplier.mutateAsync({
          name: DEFAULT_SUPPLIER_NAME,
          // Re-uploading the same file must not create duplicates.
          duplicateStrategy: 'SKIP',
        })) as unknown as { supplierId?: string; supplier?: { supplierId?: string } };
        supplierId = created.supplierId ?? created.supplier?.supplierId ?? '';
        if (!supplierId) throw new Error('The supplier could not be created. Please try again.');
        setSupplierChoice(supplierId);
      }
      const [started] = await importFiles.mutateAsync({ supplierId, files: [selectedFile] });
      setImportJobId(started?.importJobId ?? null);
      setUploadSuccess(true);
    } catch (err) {
      setUploadError(describeProductError(err, 'The upload failed. Please try again.'));
    }
  }, [selectedFile, validationErrors, supplierChoice, createSupplier, importFiles]);

  const canUpload =
    selectedFile !== null &&
    validationErrors.length === 0 &&
    !isValidating &&
    !isUploading &&
    !suppliersQuery.isLoading;

  const supplierOptions = [
    ...suppliers.map((s) => ({ value: s.supplierId, label: s.name })),
    ...(suppliers.length === 0 ? [{ value: NEW_SUPPLIER, label: `${DEFAULT_SUPPLIER_NAME} (created now)` }] : []),
  ];

  return (
    <Modal
      open={open}
      onOpenChange={handleClose}
      title="Upload Products CSV"
      description="Upload a CSV of your products. Each row needs a SKU and a title, plus a description or an image link. Brand and price are optional."
    >
      <div className="flex flex-col gap-4">
        {/* Supplier: imports are grouped per supplier, which sets duplicate handling */}
        <div>
          <Select
            label="Supplier"
            value={supplierChoice}
            onValueChange={setSupplierChoice}
            options={supplierOptions}
            placeholder={suppliersQuery.isLoading ? 'Loading suppliers…' : 'Choose a supplier'}
            disabled={isUploading || suppliersQuery.isLoading}
          />
          <p className="mt-1 text-xs text-gray-500">
            {suppliers.length === 0
              ? `We'll create "${DEFAULT_SUPPLIER_NAME}" for your own products. Rows whose SKU already exists are skipped.`
              : 'Duplicate SKUs are handled with the supplier\'s setting (skip, merge or flag).'}
          </p>
        </div>

        {/* File Upload */}
        <FileUpload
          label="CSV File"
          acceptedTypes={['text/csv', 'application/vnd.ms-excel']}
          maxSizeBytes={MAX_FILE_SIZE}
          onFilesSelected={handleFileSelected}
          disabled={isUploading}
          hint="CSV, max 10 MB, up to 10,000 rows. Required columns: sku, title."
          aria-label="Upload products CSV file"
        />

        {/* Selected file info */}
        {selectedFile && !isValidating && validationErrors.length === 0 && (
          <Alert variant="success" title="File ready">
            <span className="font-medium">{selectedFile.name}</span> ({formatFileSize(selectedFile.size)}) is ready to upload.
          </Alert>
        )}

        {/* Validating state */}
        {isValidating && (
          <p className="text-sm text-gray-600" aria-live="polite">
            Validating file…
          </p>
        )}

        {/* Validation errors (Requirement 5.10) */}
        {validationErrors.length > 0 && (
          <div aria-live="assertive">
            <Alert variant="error" title="Validation Errors">
              <p className="mb-2">
                {validationErrors.length >= MAX_ERRORS_DISPLAYED
                  ? `Showing first ${MAX_ERRORS_DISPLAYED} errors:`
                  : `${validationErrors.length} error${validationErrors.length > 1 ? 's' : ''} found:`}
              </p>
              <ul className="max-h-48 overflow-y-auto space-y-1 text-xs">
                {validationErrors.map((err, idx) => (
                  <li key={idx} className="flex gap-2">
                    {err.row > 0 && (
                      <span className="font-medium text-red-700 shrink-0">
                        Row {err.row}:
                      </span>
                    )}
                    <span>{err.message}</span>
                  </li>
                ))}
              </ul>
            </Alert>
          </div>
        )}

        {/* Upload error from API */}
        {uploadError && (
          <div aria-live="assertive">
            <Alert variant="error" title="Upload failed" dismissible onDismiss={() => setUploadError(null)}>
              {uploadError}
            </Alert>
          </div>
        )}

        {/* Success message */}
        {uploadSuccess && (
          <div aria-live="polite">
            <Alert variant="success" title="Import started">
              Your file is uploaded and being imported. Products appear as drafts in about a minute.{' '}
              {importJobId && (
                <Link href={`/imports/${encodeURIComponent(importJobId)}`} className="font-medium underline">
                  Follow the import
                </Link>
              )}
            </Alert>
          </div>
        )}

        {/* Actions */}
        <div className="flex justify-end gap-3 pt-2">
          <button
            type="button"
            onClick={() => handleClose(false)}
            className="rounded-md border border-gray-300 bg-white px-4 py-2 text-sm font-medium text-gray-700 shadow-sm hover:bg-gray-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-600 focus-visible:ring-offset-2"
          >
            {uploadSuccess ? 'Close' : 'Cancel'}
          </button>
          {!uploadSuccess && (
            <button
              type="button"
              onClick={handleUpload}
              disabled={!canUpload}
              className="rounded-md bg-blue-600 px-4 py-2 text-sm font-medium text-white shadow-sm hover:bg-blue-700 disabled:cursor-not-allowed disabled:opacity-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-600 focus-visible:ring-offset-2"
            >
              {isUploading ? 'Uploading…' : 'Upload'}
            </button>
          )}
        </div>
      </div>
    </Modal>
  );
}

/**
 * Parse a single CSV row handling quoted fields.
 */
function parseCSVRow(line: string): string[] {
  const fields: string[] = [];
  let current = '';
  let inQuotes = false;

  for (let i = 0; i < line.length; i++) {
    const char = line[i];
    if (char === '"' && !inQuotes) {
      inQuotes = true;
    } else if (char === '"' && inQuotes) {
      if (i + 1 < line.length && line[i + 1] === '"') {
        current += '"';
        i++;
      } else {
        inQuotes = false;
      }
    } else if (char === ',' && !inQuotes) {
      fields.push(current);
      current = '';
    } else {
      current += char;
    }
  }
  fields.push(current);
  return fields;
}

function formatFileSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}
