'use client';

import React, { useState } from 'react';
import { z } from 'zod';

// ─── Validation ───────────────────────────────────────────────────────────────

const resolutionNoteSchema = z
  .string()
  .trim()
  .min(1, 'Resolution note is required.')
  .max(1000, 'Resolution note must be 1000 characters or fewer.');

// ─── Props ────────────────────────────────────────────────────────────────────

export interface AlertResolutionFormProps {
  /** Called with the validated resolution note on submit */
  onSubmit: (note: string) => void;
  /** Whether the form is currently submitting */
  isSubmitting?: boolean;
  /** Optional server error to display */
  serverError?: string | null;
}

// ─── Component ────────────────────────────────────────────────────────────────

/**
 * AlertResolutionForm — Inline form for entering a resolution note (1-1000 chars).
 *
 * Requirements: 8.2, 8.3
 */
export function AlertResolutionForm({
  onSubmit,
  isSubmitting = false,
  serverError,
}: AlertResolutionFormProps) {
  const [note, setNote] = useState('');
  const [validationError, setValidationError] = useState<string | undefined>(undefined);

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();

    const result = resolutionNoteSchema.safeParse(note);
    if (!result.success) {
      setValidationError(result.error.issues[0]?.message ?? 'Invalid note.');
      return;
    }

    setValidationError(undefined);
    onSubmit(result.data);
  };

  const handleChange = (e: React.ChangeEvent<HTMLTextAreaElement>) => {
    const value = e.target.value;
    setNote(value);
    // Live validation feedback once user has seen an error
    if (validationError) {
      const r = resolutionNoteSchema.safeParse(value);
      setValidationError(r.success ? undefined : (r.error.issues[0]?.message ?? undefined));
    }
  };

  const error = validationError || serverError;

  return (
    <form onSubmit={handleSubmit} className="mt-3 space-y-3" aria-label="Resolve alert">
      <div className="space-y-1.5">
        <label
          htmlFor="resolution-note"
          className="text-sm font-medium text-gray-700"
        >
          Resolution Note <span className="text-red-500" aria-hidden="true">*</span>
        </label>
        <textarea
          id="resolution-note"
          value={note}
          onChange={handleChange}
          rows={3}
          maxLength={1000}
          placeholder="Describe the resolution or action taken…"
          disabled={isSubmitting}
          aria-required="true"
          aria-invalid={error ? true : undefined}
          aria-describedby={error ? 'resolution-note-error' : 'resolution-note-hint'}
          className={[
            'w-full resize-none rounded-md border px-3 py-2 text-sm text-gray-900 shadow-sm placeholder:text-gray-400',
            'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-offset-2',
            error
              ? 'border-red-500 focus-visible:ring-red-500'
              : 'border-gray-300 hover:border-gray-400 focus-visible:ring-blue-600',
            isSubmitting ? 'cursor-not-allowed opacity-60' : '',
          ].join(' ')}
        />
        <div className="flex items-start justify-between">
          {error ? (
            <p
              id="resolution-note-error"
              className="text-sm text-red-600"
              role="alert"
              aria-live="assertive"
            >
              {error}
            </p>
          ) : (
            <p id="resolution-note-hint" className="text-xs text-gray-400">
              1–1000 characters required
            </p>
          )}
          <p className="ml-2 flex-shrink-0 text-xs text-gray-400">
            {note.trim().length}/1000
          </p>
        </div>
      </div>

      <button
        type="submit"
        disabled={isSubmitting}
        aria-busy={isSubmitting}
        className="inline-flex items-center gap-2 rounded-md bg-blue-600 px-4 py-2 text-sm font-medium text-white shadow-sm transition-colors hover:bg-blue-700 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-600 focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-60"
      >
        {isSubmitting && (
          <svg
            className="h-4 w-4 animate-spin"
            xmlns="http://www.w3.org/2000/svg"
            fill="none"
            viewBox="0 0 24 24"
            aria-hidden="true"
          >
            <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
            <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
          </svg>
        )}
        {isSubmitting ? 'Resolving…' : 'Resolve Alert'}
      </button>
    </form>
  );
}
