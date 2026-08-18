import { Hono } from 'hono';
import type { Context } from 'hono';
import { requireAuth } from '../identity.js';
import * as service from '../services/people.js';
import { scopeFor, NOT_OWNER } from '../services/scope.js';
import { createPersonSchema, updatePersonSchema, listPeopleQuerySchema } from '../validators/people.js';
import { ok, err } from '@wyrhta/core/http';
import { validationError } from '../lib/validation.js';

export const peopleRouter = new Hono();

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

peopleRouter.use('*', requireAuth);

peopleRouter.get('/', async (c) => {
  const query = listPeopleQuerySchema.safeParse(c.req.query());
  if (!query.success) return validationError(c, query.error, 'query parameters');

  const { rows, total, limit, offset } = await service.listPeople(scope(c), query.data);
  return ok(c, rows, { total, limit, offset });
});

peopleRouter.post('/', async (c) => {
  const body = createPersonSchema.safeParse(await c.req.json());
  if (!body.success) return validationError(c, body.error);

  const person = await service.createPerson(scope(c), body.data);
  return ok(c, person, undefined, 201);
});

peopleRouter.get('/:id', async (c) => {
  const person = await service.getPerson(scope(c), c.req.param('id'));
  if (!person) return err(c, 'NOT_FOUND', 'Person not found', 404);
  return ok(c, person);
});

peopleRouter.patch('/:id', async (c) => {
  const body = updatePersonSchema.safeParse(await c.req.json());
  if (!body.success) return validationError(c, body.error);

  // ADR 0004 §4 — only the owner may change `visibility` or the share set.
  // 403 and not 404 here on purpose: the item is already visible to this
  // caller, so refusing the write discloses nothing they did not know. The
  // "invisible = nonexistent" 404 rule applies to items OUTSIDE the scope, and
  // those never reach this line — the service returns null and we 404 above.
  try {
    const person = await service.updatePerson(scope(c), c.req.param('id'), body.data);
    if (!person) return err(c, 'NOT_FOUND', 'Person not found', 404);
    return ok(c, person);
  } catch (e: unknown) {
    if (e instanceof Error && e.message === NOT_OWNER) {
      return err(c, 'FORBIDDEN', 'Only the owner may change visibility or sharing', 403);
    }
    throw e;
  }
});

peopleRouter.delete('/:id', async (c) => {
  const person = await service.deletePerson(scope(c), c.req.param('id'));
  if (!person) return err(c, 'NOT_FOUND', 'Person not found', 404);
  return ok(c, { id: person.id });
});
