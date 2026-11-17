import { defineConfig } from 'vitest/config';
import path from 'path';

export default defineConfig({
  resolve: {
    alias: {
      '@merch-os/types': path.resolve(__dirname, '../../packages/types/src/index.ts'),
    },
  },
  test: {
    globals: true,
    environment: 'node',
    include: [
      'providers/__tests__/**/*.test.ts',
      'services/__tests__/**/*.test.ts',
      'api/__tests__/**/*.test.ts',
    ],
    coverage: {
      provider: 'v8',
    },
  },
});
