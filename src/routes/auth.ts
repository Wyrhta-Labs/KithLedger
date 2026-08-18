import { Hono } from 'hono';
import { z } from 'zod';
import { ok, err, rateLimit } from '@wyrhta/core/http';
import { validationError } from '../lib/validation.js';
import { logEvent } from '@wyrhta/core/lib';
import { identity, requireJwt, requireLocalAccount, ADMIN_EMAIL } from '../identity.js';

export const authRouter = new Hono();

const tokenSchema = z.object({
  // Per-user login (B4). Omitted means the local admin — the deployment was
  // single-user until now and the web UI's login form still posts a password
  // alone, so keeping the default preserves both. Heorth-authored members can
  // never authenticate here whatever they supply: their `password_hash` is not
  // an argon2 hash (see `src/services/members.ts`).
  email: z.string().email().optional(),
  password: z.string(),
});

const createKeySchema = z.object({
  name: z.string().min(1),
});

function getIp(c: Parameters<ReturnType<typeof rateLimit>>[0]): string {
  return (
    c.req.header('x-forwarded-for')?.split(',')[0]?.trim() ??
    c.req.header('cf-connecting-ip') ??
    'unknown'
  );
}

authRouter.post('/token', rateLimit(), async (c) => {
  const body = tokenSchema.safeParse(await c.req.json());
  if (!body.success) {
    return validationError(c, body.error);
  }

  const ip = getIp(c);
  const requestId = c.get('requestId');

  const email = body.data.email ?? ADMIN_EMAIL;
  const user = await identity.authenticate(email, body.data.password);
  if (!user) {
    logEvent({ event: 'auth.token.failure', ip, success: false, request_id: requestId });
    return err(c, 'UNAUTHORIZED', 'Invalid password', 401);
  }

  const { token, expiresIn } = await identity.issueToken(user);
  logEvent({ event: 'auth.token.success', ip, success: true, request_id: requestId });
  return ok(c, { token, expires_in: expiresIn });
});

/**
 * Key management acts on the AUTHENTICATED CALLER, not on a hardcoded admin
 * (B4). `requireLocalAccount` additionally refuses Heorth-authored members —
 * see `src/identity.ts` for why they must not hold long-lived `kl_` keys.
 */
function callerId(c: { get: (k: 'principal') => { userId: string } | undefined }): string {
  const principal = c.get('principal');
  // Unreachable: `requireJwt` sets the principal or returns 401 itself.
  if (!principal) throw new Error('No principal on an authenticated route');
  return principal.userId;
}

authRouter.get('/keys', requireJwt, requireLocalAccount, async (c) => {
  const rows = await identity.listApiKeys(callerId(c));
  // Core names the column `prefix`; POST /keys already returns it as
  // `keyPrefix`. Normalize here so both endpoints expose one field name.
  return ok(
    c,
    rows.map((row) => ({
      id: row.id,
      name: row.name,
      keyPrefix: row.prefix,
      lastUsedAt: row.lastUsedAt,
      createdAt: row.createdAt,
    }))
  );
});

authRouter.post('/keys', requireJwt, requireLocalAccount, async (c) => {
  const body = createKeySchema.safeParse(await c.req.json());
  if (!body.success) {
    return validationError(c, body.error);
  }

  const key = await identity.createApiKey(callerId(c), body.data.name);

  logEvent({ event: 'auth.key.created', key_id: key.id, key_name: key.name, request_id: c.get('requestId') });

  return ok(
    c,
    { id: key.id, name: key.name, key: key.key, keyPrefix: key.prefix, createdAt: key.createdAt },
    undefined,
    201
  );
});

authRouter.delete('/keys/:id', requireJwt, requireLocalAccount, async (c) => {
  const keyId = c.req.param('id');
  const revoked = await identity.revokeApiKey(callerId(c), keyId);
  if (!revoked) return err(c, 'NOT_FOUND', 'API key not found', 404);
  logEvent({ event: 'auth.key.revoked', key_id: keyId, request_id: c.get('requestId') });
  return ok(c, { id: keyId });
});
