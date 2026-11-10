import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['src/**/*.test.ts'],
    // The leak-integrity test loads all 34 large generated JSON schemas.
    testTimeout: 60_000,
  },
});
