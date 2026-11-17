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
    // Handlers bundle heavy deps; give headroom when suites run in parallel under turbo/CI.
    testTimeout: 30000,
    hookTimeout: 30000,
    environment: 'node',
    include: ['__tests__/unit/**/*.test.ts', '__tests__/integration/**/*.test.ts'],
    coverage: {
      provider: 'v8',
    },
  },
});
