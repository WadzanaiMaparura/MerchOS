import { defineConfig } from 'vitest/config';
import path from 'path';

export default defineConfig({
  resolve: {
    alias: {
      '@merch-os/types': path.resolve(__dirname, '../../packages/types/src/index.ts'),
      '@merch-os/marketplace-schemas': path.resolve(
        __dirname,
        '../../packages/marketplace-schemas/src/index.ts'
      ),
    },
  },
  test: {
    globals: true,
    environment: 'node',
    include: ['engine/__tests__/**/*.test.ts', 'api/__tests__/**/*.test.ts'],
    testTimeout: 30_000,
    coverage: { provider: 'v8' },
  },
});
