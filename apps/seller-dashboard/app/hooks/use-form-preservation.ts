'use client';

import { useEffect, useCallback } from 'react';
import { useFormPreservationStore } from '../stores/form-preservation-store';

/**
 * Hook for preserving form data across error boundary reloads.
 *
 * Usage:
 *   const { savedData, saveData, clearSavedData } = useFormPreservation('product-edit-123');
 *   // On mount: restore savedData if available
 *   // On form change: call saveData(formValues) to persist
 *   // On successful submit: call clearSavedData()
 *
 * Requirement: 13.6 — Preserve user's in-progress input so it remains available
 * after the error is resolved or the page is reloaded via the error boundary.
 */
export function useFormPreservation(formKey: string) {
  const saveFormData = useFormPreservationStore((state) => state.saveFormData);
  const getFormData = useFormPreservationStore((state) => state.getFormData);
  const clearFormData = useFormPreservationStore((state) => state.clearFormData);

  /** Get previously saved form data for this key */
  const savedData = getFormData(formKey);

  /** Save current form data (call on value changes) */
  const saveData = useCallback(
    (data: Record<string, unknown>) => {
      saveFormData(formKey, data);
    },
    [formKey, saveFormData]
  );

  /** Clear saved data (call on successful submit) */
  const clearSavedData = useCallback(() => {
    clearFormData(formKey);
  }, [formKey, clearFormData]);

  return { savedData, saveData, clearSavedData };
}
