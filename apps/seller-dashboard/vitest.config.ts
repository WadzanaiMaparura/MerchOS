import { defineConfig } from 'vitest/config';
import path from 'path';

export default defineConfig({
  esbuild: {
    jsx: 'automatic',
  },
  test: {
    environment: 'jsdom',
    globals: true,
    setupFiles: ['./vitest.setup.ts'],
    include: ['__tests__/**/*.test.ts', '__tests__/**/*.test.tsx'],
  },
  resolve: {
    alias: {
      '@': path.resolve(__dirname, '.'),
      '@merch-os/types': path.resolve(__dirname, '../../packages/types/src'),
      '@merch-os/auth': path.resolve(__dirname, '../../packages/auth/src'),
      '@merch-os/api-client': path.resolve(__dirname, '../../packages/api-client/src'),
      '@merch-os/ui': path.resolve(__dirname, '../../packages/ui/src'),
      '@merch-os/rbac': path.resolve(__dirname, '../../packages/rbac/src'),
    },
  },
});
