import { Hono } from 'hono';
import { z } from 'zod';
import { ok, err, rateLimit } from '@wyrhta/core/http';
import { logEvent } from '@wyrhta/core/lib';
import { identity, requireJwt, getAdminUser, ADMIN_EMAIL } from '../identity.js';

export const authRouter = new Hono();

const tokenSchema = z.object({
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
    return err(c, 'VALIDATION_ERROR', 'Invalid request body', 400);
  }

  const ip = getIp(c);
  const requestId = c.get('requestId');

  const user = await identity.authenticate(ADMIN_EMAIL, body.data.password);
  if (!user) {
    logEvent({ event: 'auth.token.failure', ip, success: false, request_id: requestId });
    return err(c, 'UNAUTHORIZED', 'Invalid password', 401);
  }

  const { token, expiresIn } = await identity.issueToken(user);
  logEvent({ event: 'auth.token.success', ip, success: true, request_id: requestId });
  return ok(c, { token, expires_in: expiresIn });
});

authRouter.get('/keys', requireJwt, async (c) => {
  const admin = await getAdminUser();
  const rows = await identity.listApiKeys(admin.id);
  return ok(c, rows);
});

authRouter.post('/keys', requireJwt, async (c) => {
  const body = createKeySchema.safeParse(await c.req.json());
  if (!body.success) {
    return err(c, 'VALIDATION_ERROR', 'Invalid request body', 400);
  }

  const admin = await getAdminUser();
  const key = await identity.createApiKey(admin.id, body.data.name);

  logEvent({ event: 'auth.key.created', key_id: key.id, key_name: key.name, request_id: c.get('requestId') });

  return ok(
    c,
    { id: key.id, name: key.name, key: key.key, keyPrefix: key.prefix, createdAt: key.createdAt },
    undefined,
    201
  );
});

authRouter.delete('/keys/:id', requireJwt, async (c) => {
  const admin = await getAdminUser();
  const keyId = c.req.param('id');
  const revoked = await identity.revokeApiKey(admin.id, keyId);
  if (!revoked) return err(c, 'NOT_FOUND', 'API key not found', 404);
  logEvent({ event: 'auth.key.revoked', key_id: keyId, request_id: c.get('requestId') });
  return ok(c, { id: keyId });
});
