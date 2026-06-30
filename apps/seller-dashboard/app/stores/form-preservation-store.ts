'use client';

import { create } from 'zustand';

/**
 * Store for preserving unsaved form input across error boundary reloads.
 * Forms register their data by a unique key, and restore it after recovery.
 */
interface FormPreservationStore {
  /** Map of form key → serialized form data */
  savedForms: Record<string, Record<string, unknown>>;
  /** Save form data for a given key */
  saveFormData: (key: string, data: Record<string, unknown>) => void;
  /** Retrieve saved form data for a given key */
  getFormData: (key: string) => Record<string, unknown> | null;
  /** Clear saved form data for a given key */
  clearFormData: (key: string) => void;
  /** Clear all saved form data */
  clearAll: () => void;
}

export const useFormPreservationStore = create<FormPreservationStore>((set, get) => ({
  savedForms: {},

  saveFormData: (key, data) => {
    set((state) => ({
      savedForms: { ...state.savedForms, [key]: data },
    }));
  },

  getFormData: (key) => {
    return get().savedForms[key] ?? null;
  },

  clearFormData: (key) => {
    set((state) => {
      const { [key]: _, ...rest } = state.savedForms;
      return { savedForms: rest };
    });
  },

  clearAll: () => {
    set({ savedForms: {} });
  },
}));
