import { Hono } from 'hono';
import type { Context } from 'hono';
import { requireAuth } from '../identity.js';
import * as service from '../services/interactions.js';
import { scopeFor, NOT_OWNER } from '../services/scope.js';
import { createInteractionSchema, updateInteractionSchema, listInteractionsQuerySchema } from '../validators/interactions.js';
import { ok, err } from '@wyrhta/core/http';
import { validationError } from '../lib/validation.js';

export const interactionsRouter = new Hono();

/**
 * ADR 0004 §2 — every handler resolves the caller to a visibility scope and
 * hands it to the service. The route still knows nothing about Drizzle: the
 * scope is an opaque value produced from the principal `requireAuth` already
 * set, and every filtering decision happens in `src/services/`.
 */
function scope(c: Context) {
  const principal = c.get('principal');
  if (!principal) throw new Error('UNAUTHENTICATED');
  return scopeFor(principal);
}

interactionsRouter.use('*', requireAuth);

interactionsRouter.get('/', async (c) => {
  const query = listInteractionsQuerySchema.safeParse(c.req.query());
  if (!query.success) return validationError(c, query.error, 'query parameters');

  const { rows, total, limit, offset } = await service.listInteractions(scope(c), query.data);
  return ok(c, rows, { total, limit, offset });
});

interactionsRouter.post('/', async (c) => {
  const body = createInteractionSchema.safeParse(await c.req.json());
  if (!body.success) return validationError(c, body.error);

  try {
    const interaction = await service.createInteraction(scope(c), body.data);
    return ok(c, interaction, undefined, 201);
  } catch (e: unknown) {
    if (e instanceof Error && e.message === 'PERSON_NOT_FOUND') {
      return err(c, 'NOT_FOUND', 'Person not found', 404);
    }
    throw e;
  }
});

interactionsRouter.get('/:id', async (c) => {
  const interaction = await service.getInteraction(scope(c), c.req.param('id'));
  if (!interaction) return err(c, 'NOT_FOUND', 'Interaction not found', 404);
  return ok(c, interaction);
});

interactionsRouter.patch('/:id', async (c) => {
  const body = updateInteractionSchema.safeParse(await c.req.json());
  if (!body.success) return validationError(c, body.error);

  // ADR 0004 §4 — only the owner may change `visibility` or the share set.
  // 403 and not 404 here on purpose: the item is already visible to this
  // caller, so refusing the write discloses nothing they did not know. The
  // "invisible = nonexistent" 404 rule applies to items OUTSIDE the scope, and
  // those never reach this line — the service returns null and we 404 above.
  try {
    const interaction = await service.updateInteraction(scope(c), c.req.param('id'), body.data);
    if (!interaction) return err(c, 'NOT_FOUND', 'Interaction not found', 404);
    return ok(c, interaction);
  } catch (e: unknown) {
    if (e instanceof Error && e.message === NOT_OWNER) {
      return err(c, 'FORBIDDEN', 'Only the owner may change visibility or sharing', 403);
    }
    throw e;
  }
});

interactionsRouter.delete('/:id', async (c) => {
  const interaction = await service.deleteInteraction(scope(c), c.req.param('id'));
  if (!interaction) return err(c, 'NOT_FOUND', 'Interaction not found', 404);
  return ok(c, { id: interaction.id });
});
