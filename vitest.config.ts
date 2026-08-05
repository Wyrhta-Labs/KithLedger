import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    globals: true,
    setupFiles: ['./tests/setup.ts'],
    environment: 'node',
    // e2e/ holds Playwright specs. Vitest's default glob matches `*.spec.ts`
    // anywhere, so without this `npm test` would try to run them itself — and
    // its setup file would truncate the database out from under them.
    exclude: ['**/node_modules/**', '**/dist/**', 'e2e/**', 'web/**'],
    poolOptions: {
      forks: {
        singleFork: true,
      },
    },
  },
});
