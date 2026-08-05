import { defineConfig, devices } from '@playwright/test';

/**
 * End-to-end suite: drives the real React UI in a browser against a running
 * API. Separate from `npm test`, which is the Vitest API/integration suite.
 *
 * These specs create and delete their own records through the API. Everything
 * they make is prefixed (see e2e/fixtures.ts) and removed afterwards, but they
 * still write to whatever database the API is pointed at — run them against the
 * dev stack, never a database you care about.
 *
 * Requires the API to be up (default http://localhost:4002, e.g. via
 * `npm run docker:up`). Vite is started automatically by `webServer` below.
 */
export const E2E_WEB_PORT = Number(process.env['E2E_WEB_PORT'] ?? 5174);
export const E2E_API_URL = process.env['E2E_API_URL'] ?? 'http://localhost:4002';

export default defineConfig({
  testDir: './e2e',
  globalSetup: './e2e/global-setup.ts',
  // Serial: the specs share one database and assert on list contents, so
  // parallel workers would see each other's fixtures.
  fullyParallel: false,
  workers: 1,
  forbidOnly: !!process.env['CI'],
  retries: process.env['CI'] ? 1 : 0,
  reporter: process.env['CI'] ? [['list'], ['html', { open: 'never' }]] : [['list']],
  timeout: 60_000,
  expect: { timeout: 10_000 },
  use: {
    baseURL: `http://localhost:${E2E_WEB_PORT}`,
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
  },
  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'] } }],
  webServer: {
    // web/vite.config.ts proxies /api to the API port.
    command: `npx vite --port ${E2E_WEB_PORT} --strictPort`,
    cwd: 'web',
    url: `http://localhost:${E2E_WEB_PORT}`,
    reuseExistingServer: !process.env['CI'],
    timeout: 120_000,
    stdout: 'pipe',
    stderr: 'pipe',
  },
});
