// Vitest setup file
// Note: @testing-library/jest-dom/vitest matchers are loaded conditionally
// to avoid module resolution issues with aria-query
export {};

try {
  await import('@testing-library/jest-dom/vitest');
} catch {
  // jest-dom matchers not available - property tests don't need them
}
