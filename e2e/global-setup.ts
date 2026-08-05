import { E2E_API_URL } from '../playwright.config.js';

/**
 * Fail fast with an actionable message when the suite's preconditions are not
 * met. Without this, a missing API surfaces as a wall of timeouts inside the
 * browser and looks like a UI regression.
 */
export default async function globalSetup() {
  if (!process.env['ADMIN_PASSWORD']) {
    throw new Error(
      'ADMIN_PASSWORD is not set. The e2e suite logs in as the seeded admin.\n' +
        'Export the same value the running API was started with, e.g.\n' +
        '  ADMIN_PASSWORD=… npm run test:e2e'
    );
  }

  let res: Response;
  try {
    res = await fetch(`${E2E_API_URL}/health`);
  } catch {
    throw new Error(
      `Cannot reach the API at ${E2E_API_URL}. Start it first (npm run docker:up), ` +
        'or point E2E_API_URL at a running instance.'
    );
  }
  if (!res.ok) throw new Error(`API health check at ${E2E_API_URL} returned ${res.status}.`);

  // Confirm the password actually works, so a wrong one is a clear error here
  // rather than a failed login assertion in every spec.
  const auth = await fetch(`${E2E_API_URL}/api/v1/auth/token`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ password: process.env['ADMIN_PASSWORD'] }),
  });
  if (auth.status === 429) {
    // A 429 says nothing about whether the password is right. `/auth/token` is
    // limited to 10 requests per 15 minutes per IP, and this suite spends a
    // handful per run, so a few runs back to back can exhaust it. Restarting
    // the API clears the in-memory window.
    console.warn(
      `[e2e] ${E2E_API_URL} is rate-limiting /auth/token (429), so the password ` +
        'could not be verified up front. Continuing — if logins fail, wait for ' +
        'the 15-minute window or restart the API.'
    );
    return;
  }
  if (!auth.ok) {
    throw new Error(
      `ADMIN_PASSWORD was rejected by ${E2E_API_URL} (HTTP ${auth.status}). ` +
        'It must match the password the API seeded its admin user with.'
    );
  }
}
