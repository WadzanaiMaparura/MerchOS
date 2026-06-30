'use client';

import React, { useCallback, useId, useRef, useState } from 'react';

export interface FileUploadProps {
  /** Label text displayed above the upload area */
  label?: string;
  /** Accepted MIME types (e.g., ['image/jpeg', 'image/png', 'image/webp']) */
  acceptedTypes?: string[];
  /** Maximum file size in bytes */
  maxSizeBytes?: number;
  /** Whether multiple files can be uploaded */
  multiple?: boolean;
  /** Callback when files are selected and validated */
  onFilesSelected: (files: File[]) => void;
  /** Error message from external validation */
  error?: string;
  /** Whether the component is disabled */
  disabled?: boolean;
  /** Optional aria-label for the upload area */
  'aria-label'?: string;
  /** Optional aria-labelledby for custom label association */
  'aria-labelledby'?: string;
  /** Hint text displayed below the upload area */
  hint?: string;
}

interface ValidationError {
  file: string;
  reason: string;
}

/**
 * FileUpload - Accessible drag-and-drop file upload with type/size validation.
 * Supports keyboard interaction, ARIA labels, and validation error announcements.
 * Meets WCAG 2.1 AA requirements for form inputs (Requirement 14.3).
 */
export function FileUpload({
  label,
  acceptedTypes,
  maxSizeBytes = 10 * 1024 * 1024, // 10 MB default
  multiple = false,
  onFilesSelected,
  error: externalError,
  disabled = false,
  'aria-label': ariaLabel,
  'aria-labelledby': ariaLabelledBy,
  hint,
}: FileUploadProps) {
  const generatedId = useId();
  const inputId = `${generatedId}-file-input`;
  const errorId = `${generatedId}-file-error`;
  const hintId = `${generatedId}-file-hint`;
  const inputRef = useRef<HTMLInputElement>(null);

  const [isDragOver, setIsDragOver] = useState(false);
  const [validationErrors, setValidationErrors] = useState<ValidationError[]>([]);

  const validateFiles = useCallback(
    (files: FileList | File[]): { valid: File[]; errors: ValidationError[] } => {
      const valid: File[] = [];
      const errors: ValidationError[] = [];

      const fileArray = Array.from(files);

      for (const file of fileArray) {
        if (acceptedTypes && acceptedTypes.length > 0) {
          const isAccepted = acceptedTypes.some((type) => {
            if (type.endsWith('/*')) {
              return file.type.startsWith(type.replace('/*', '/'));
            }
            return file.type === type;
          });
          if (!isAccepted) {
            errors.push({
              file: file.name,
              reason: `Unsupported file type: ${file.type || 'unknown'}. Accepted: ${acceptedTypes.join(', ')}`,
            });
            continue;
          }
        }

        if (file.size > maxSizeBytes) {
          const maxMB = (maxSizeBytes / (1024 * 1024)).toFixed(1);
          const fileMB = (file.size / (1024 * 1024)).toFixed(1);
          errors.push({
            file: file.name,
            reason: `File size ${fileMB} MB exceeds maximum of ${maxMB} MB`,
          });
          continue;
        }

        valid.push(file);
      }

      return { valid, errors };
    },
    [acceptedTypes, maxSizeBytes]
  );

  const handleFiles = useCallback(
    (files: FileList | File[]) => {
      if (disabled) return;

      const { valid, errors } = validateFiles(files);
      setValidationErrors(errors);

      if (valid.length > 0) {
        const firstFile = valid[0];
        if (multiple) {
          onFilesSelected(valid);
        } else if (firstFile) {
          onFilesSelected([firstFile]);
        }
      }
    },
    [disabled, validateFiles, onFilesSelected, multiple]
  );

  const handleDragOver = useCallback(
    (e: React.DragEvent<HTMLDivElement>) => {
      e.preventDefault();
      e.stopPropagation();
      if (!disabled) {
        setIsDragOver(true);
      }
    },
    [disabled]
  );

  const handleDragLeave = useCallback((e: React.DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    e.stopPropagation();
    setIsDragOver(false);
  }, []);

  const handleDrop = useCallback(
    (e: React.DragEvent<HTMLDivElement>) => {
      e.preventDefault();
      e.stopPropagation();
      setIsDragOver(false);

      if (disabled) return;

      const { files } = e.dataTransfer;
      if (files && files.length > 0) {
        handleFiles(files);
      }
    },
    [disabled, handleFiles]
  );

  const handleInputChange = useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) => {
      const { files } = e.target;
      if (files && files.length > 0) {
        handleFiles(files);
      }
      // Reset input value to allow re-selecting the same file
      e.target.value = '';
    },
    [handleFiles]
  );

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent<HTMLDivElement>) => {
      if (disabled) return;
      if (e.key === 'Enter' || e.key === ' ') {
        e.preventDefault();
        inputRef.current?.click();
      }
    },
    [disabled]
  );

  const displayError = externalError || (validationErrors.length > 0 ? validationErrors.map((err) => `${err.file}: ${err.reason}`).join('; ') : undefined);

  const describedByIds = [
    hint ? hintId : null,
    displayError ? errorId : null,
  ]
    .filter(Boolean)
    .join(' ') || undefined;

  return (
    <div className="flex flex-col gap-1.5">
      {label && (
        <label
          htmlFor={inputId}
          className="text-sm font-medium text-gray-700"
        >
          {label}
        </label>
      )}
      <div
        role="button"
        tabIndex={disabled ? -1 : 0}
        aria-label={!label ? ariaLabel : undefined}
        aria-labelledby={ariaLabelledBy}
        aria-describedby={describedByIds}
        aria-invalid={displayError ? true : undefined}
        aria-disabled={disabled}
        onDragOver={handleDragOver}
        onDragLeave={handleDragLeave}
        onDrop={handleDrop}
        onClick={() => !disabled && inputRef.current?.click()}
        onKeyDown={handleKeyDown}
        className={[
          'flex flex-col items-center justify-center rounded-lg border-2 border-dashed px-6 py-8 text-center transition-colors',
          'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-600 focus-visible:ring-offset-2',
          isDragOver && !disabled
            ? 'border-blue-500 bg-blue-50'
            : 'border-gray-300',
          disabled
            ? 'cursor-not-allowed bg-gray-50 opacity-60'
            : 'cursor-pointer hover:border-gray-400 hover:bg-gray-50',
          displayError ? 'border-red-500' : '',
        ]
          .filter(Boolean)
          .join(' ')}
      >
        <svg
          xmlns="http://www.w3.org/2000/svg"
          className="mb-3 h-10 w-10 text-gray-400"
          fill="none"
          viewBox="0 0 24 24"
          stroke="currentColor"
          aria-hidden="true"
        >
          <path
            strokeLinecap="round"
            strokeLinejoin="round"
            strokeWidth={1.5}
            d="M7 16a4 4 0 01-.88-7.903A5 5 0 1115.9 6L16 6a5 5 0 011 9.9M15 13l-3-3m0 0l-3 3m3-3v12"
          />
        </svg>
        <p className="text-sm text-gray-600">
          <span className="font-medium text-blue-600">Click to upload</span> or
          drag and drop
        </p>
        {hint && (
          <p id={hintId} className="mt-1 text-xs text-gray-500">
            {hint}
          </p>
        )}
      </div>
      <input
        ref={inputRef}
        id={inputId}
        type="file"
        accept={acceptedTypes?.join(',')}
        multiple={multiple}
        disabled={disabled}
        onChange={handleInputChange}
        className="sr-only"
        tabIndex={-1}
        aria-hidden="true"
      />
      {displayError && (
        <p
          id={errorId}
          className="text-sm text-red-600"
          role="alert"
          aria-live="assertive"
        >
          {displayError}
        </p>
      )}
    </div>
  );
}
