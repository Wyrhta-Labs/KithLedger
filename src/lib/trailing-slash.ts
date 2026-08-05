import type { MiddlewareHandler } from 'hono';

/**
 * Trailing-slash redirect that emits a **relative** `Location`.
 *
 * Hono's own `trimTrailingSlash()` builds the redirect target from `c.req.url`,
 * so the header carries scheme and host as the app perceives them. Behind a
 * reverse proxy that is wrong twice over (issue #1): a proxy which strips a path
 * prefix before forwarding produces a `Location` without that prefix, sending
 * the client to a URL the proxy does not route; and a proxy that terminates TLS
 * or does not preserve `Host` leaks `http://` or the internal upstream hostname.
 *
 * A path-only `Location` is resolved by the client against the URL it actually
 * requested, which keeps prefix, host, and scheme intact. Like Hono's version
 * this only acts on GET/HEAD requests that ended up unmatched (404) — a
 * registered route is answered by the router, slash and all.
 */
export function trimTrailingSlash(): MiddlewareHandler {
  return async function trimTrailingSlash(c, next) {
    await next();

    if (
      c.res.status !== 404 ||
      (c.req.method !== 'GET' && c.req.method !== 'HEAD') ||
      c.req.path === '/' ||
      !c.req.path.endsWith('/')
    ) {
      return;
    }

    const { pathname, search } = new URL(c.req.url);
    // `|| '/'` keeps an all-slashes path (`//`) from producing an empty, and
    // therefore invalid, Location.
    const trimmed = pathname.replace(/\/+$/, '') || '/';
    c.res = c.redirect(`${trimmed}${search}`, 301);
  };
}
