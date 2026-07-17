import { defineConfig } from 'vitest/config';
import path from 'path';

export default defineConfig({
  resolve: {
    alias: {
      '@merch-os/rbac': path.resolve(__dirname, '../../packages/rbac/src/index.ts'),
    },
  },
  test: {
    globals: true,
    environment: 'node',
    include: ['**/__tests__/**/*.test.ts'],
  },
});
