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
      'repository/__tests__/**/*.test.ts',
    ],
    coverage: {
      provider: 'v8',
    },
  },
});
