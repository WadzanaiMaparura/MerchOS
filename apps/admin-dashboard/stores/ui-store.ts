'use client';

/**
 * Admin UI Store — Zustand client-state for sidebar visibility.
 *
 * Requirements: 2.1, 2.6
 */

import { create } from 'zustand';

interface AdminUIStore {
  /** Whether the sidebar is in icon-only (collapsed) mode. */
  sidebarCollapsed: boolean;
  /** Whether the mobile slide-out sidebar overlay is open. */
  mobileSidebarOpen: boolean;
  /** Toggle collapsed / expanded state. */
  toggleSidebar: () => void;
  /** Explicitly open or close the mobile sidebar. */
  setMobileSidebarOpen: (open: boolean) => void;
}

export const useAdminUIStore = create<AdminUIStore>((set) => ({
  sidebarCollapsed: false,
  mobileSidebarOpen: false,
  toggleSidebar: () => set((s) => ({ sidebarCollapsed: !s.sidebarCollapsed })),
  setMobileSidebarOpen: (open) => set({ mobileSidebarOpen: open }),
}));
