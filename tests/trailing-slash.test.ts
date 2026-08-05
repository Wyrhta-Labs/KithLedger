import { describe, it, expect } from 'vitest';
import { createApp } from '../src/app.js';

const app = createApp();

// Regression guard for issue #1: the trailing-slash redirect must not name a
// scheme or host. An absolute Location ties the redirect to the URL the app
// itself sees, which is wrong behind a proxy that rewrites the path prefix or
// does not preserve Host/scheme.
//
// Only paths that would otherwise 404 reach the redirect — a registered route
// like `/api/v1/people/` is matched by the router directly (and answers 401
// unauthenticated), so it never gets here.
describe('trailing-slash redirect', () => {
  it('redirects with a path-only Location', async () => {
    const res = await app.request('http://internal-upstream:3000/api/v1/no-such-route/');
    expect(res.status).toBe(301);
    expect(res.headers.get('location')).toBe('/api/v1/no-such-route');
  });

  it('keeps the query string on the redirect', async () => {
    const res = await app.request('http://internal-upstream:3000/api/v1/no-such-route/?limit=5');
    expect(res.status).toBe(301);
    expect(res.headers.get('location')).toBe('/api/v1/no-such-route?limit=5');
  });

  it('leaves the root path alone', async () => {
    const res = await app.request('http://internal-upstream:3000/');
    expect(res.status).not.toBe(301);
  });
});
