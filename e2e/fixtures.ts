import { test as base, type Page } from '@playwright/test';
import { E2E_API_URL } from '../playwright.config.js';

/**
 * Every record these specs create is named with this prefix, and the `api`
 * fixture deletes anything carrying it when a spec finishes. Keep it
 * distinctive: cleanup matches on it.
 */
export const FIXTURE_PREFIX = 'E2E-';

export interface ApiClient {
  token: string;
  get<T = any>(path: string): Promise<T>;
  post<T = any>(path: string, body?: unknown): Promise<T>;
  del(path: string): Promise<void>;
  /** Records created via the UI still need cleaning up; register them here. */
  trackPerson(id: string): void;
}

async function login(): Promise<string> {
  const res = await fetch(`${E2E_API_URL}/api/v1/auth/token`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ password: process.env['ADMIN_PASSWORD'] }),
  });
  if (!res.ok) throw new Error(`e2e login failed: HTTP ${res.status}`);
  const { data } = (await res.json()) as { data: { token: string } };
  return data.token;
}

export const test = base.extend<{ api: ApiClient; loggedIn: Page }, { authToken: string }>({
  /**
   * One login per worker. `POST /auth/token` is rate-limited to 10 requests per
   * window, so authenticating in every fixture exhausted the budget mid-run and
   * later logins got a 429 — which surfaced as an unrelated-looking timeout on
   * the login screen. The form itself is covered by auth.spec.ts.
   */
  authToken: [
    async ({}, use) => {
      await use(await login());
    },
    { scope: 'worker' },
  ],

  /** Authenticated API client, used for setup, assertions and teardown. */
  api: async ({ authToken: token }, use) => {
    const trackedPeople = new Set<string>();

    const request = async (path: string, init: RequestInit = {}) => {
      const res = await fetch(`${E2E_API_URL}/api/v1${path}`, {
        ...init,
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`,
          ...(init.headers ?? {}),
        },
      });
      const text = await res.text();
      const json = text ? JSON.parse(text) : null;
      if (!res.ok) {
        throw new Error(`${init.method ?? 'GET'} ${path} → ${res.status}: ${json?.error?.message ?? text}`);
      }
      return json;
    };

    const client: ApiClient = {
      token,
      get: (path) => request(path),
      post: async (path, body) => {
        const json = await request(path, { method: 'POST', body: JSON.stringify(body ?? {}) });
        if (path === '/people' && json?.data?.id) trackedPeople.add(json.data.id);
        return json;
      },
      del: async (path) => {
        await request(path, { method: 'DELETE' });
      },
      trackPerson: (id) => trackedPeople.add(id),
    };

    await use(client);

    // Teardown. Deleting a person cascades to their interactions, reminders and
    // relationships, so people are the only thing that needs sweeping.
    for (const id of trackedPeople) {
      await request(`/people/${id}`, { method: 'DELETE' }).catch(() => {});
    }
    // Catch anything created through the UI that was never registered.
    const leftovers = await request(`/people?q=${encodeURIComponent(FIXTURE_PREFIX)}&limit=100`).catch(
      () => null
    );
    for (const p of leftovers?.data ?? []) {
      if (typeof p.name === 'string' && p.name.startsWith(FIXTURE_PREFIX)) {
        await request(`/people/${p.id}`, { method: 'DELETE' }).catch(() => {});
      }
    }
  },

  /**
   * A page already past the login screen. Seeds the JWT directly rather than
   * driving the form: AuthProvider initialises from localStorage on mount, so
   * this is equivalent, and it keeps the suite inside the auth rate limit.
   */
  loggedIn: async ({ page, authToken }, use) => {
    await page.addInitScript((token) => {
      window.localStorage.setItem('kith_jwt', token);
    }, authToken);
    await page.goto('/');
    await use(page);
  },
});

export { expect } from '@playwright/test';

/** A `YYYY-MM-DD` birthday `daysFromNow` ahead, in the given birth year. */
export function birthdayInDays(daysFromNow: number, year = 1990): string {
  const d = new Date(Date.now() + daysFromNow * 86_400_000);
  return `${year}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}
