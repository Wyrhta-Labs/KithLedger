import { Hono } from 'hono';
import type { Context } from 'hono';
import { requireAuth, requireDataAccess } from '../identity.js';
import * as service from '../services/relationships.js';
import { scopeFor, NOT_OWNER } from '../services/scope.js';
import { createRelationshipSchema, updateRelationshipSchema, listRelationshipsQuerySchema, graphQuerySchema } from '../validators/relationships.js';
import { ok, err } from '@wyrhta/core/http';
import { validationError } from '../lib/validation.js';

export const relationshipsRouter = new Hono();

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

relationshipsRouter.use('*', requireAuth, requireDataAccess);

relationshipsRouter.get('/', async (c) => {
  const query = listRelationshipsQuerySchema.safeParse(c.req.query());
  if (!query.success) return validationError(c, query.error, 'query parameters');

  const { rows, total, limit, offset } = await service.listRelationships(scope(c), query.data);
  return ok(c, rows, { total, limit, offset });
});

relationshipsRouter.post('/', async (c) => {
  const body = createRelationshipSchema.safeParse(await c.req.json());
  if (!body.success) return validationError(c, body.error);

  try {
    const relationship = await service.createRelationship(scope(c), body.data);
    return ok(c, relationship, undefined, 201);
  } catch (e: unknown) {
    if (e instanceof Error) {
      if (e.message === 'FROM_PERSON_NOT_FOUND' || e.message === 'TO_PERSON_NOT_FOUND') {
        return err(c, 'NOT_FOUND', 'Person not found', 404);
      }
      if (e.message === 'RELATIONSHIP_EXISTS') {
        return err(c, 'CONFLICT', 'Relationship already exists between these people', 409);
      }
    }
    throw e;
  }
});

relationshipsRouter.get('/:id', async (c) => {
  const relationship = await service.getRelationship(scope(c), c.req.param('id'));
  if (!relationship) return err(c, 'NOT_FOUND', 'Relationship not found', 404);
  return ok(c, relationship);
});

relationshipsRouter.patch('/:id', async (c) => {
  const body = updateRelationshipSchema.safeParse(await c.req.json());
  if (!body.success) return validationError(c, body.error);

  // ADR 0004 §4 — only the owner may change `visibility` or the share set.
  // 403 and not 404 here on purpose: the item is already visible to this
  // caller, so refusing the write discloses nothing they did not know. The
  // "invisible = nonexistent" 404 rule applies to items OUTSIDE the scope, and
  // those never reach this line — the service returns null and we 404 above.
  try {
    const relationship = await service.updateRelationship(scope(c), c.req.param('id'), body.data);
    if (!relationship) return err(c, 'NOT_FOUND', 'Relationship not found', 404);
    return ok(c, relationship);
  } catch (e: unknown) {
    if (e instanceof Error && e.message === NOT_OWNER) {
      return err(c, 'FORBIDDEN', 'Only the owner may change visibility or sharing', 403);
    }
    throw e;
  }
});

relationshipsRouter.delete('/:id', async (c) => {
  // ADR 0004 §4 (B9) — deleting a `private` or `shared` item is OWNER ONLY;
  // `household` items stay deletable by any member. 403 (not 404) for a
  // non-owner, for the same reason the PATCH governance gate uses 403: the
  // item is already visible to this caller, so the refusal tells them nothing
  // new. An item OUTSIDE the scope never reaches the check — the service
  // returns null and this 404s, exactly as a non-existent id does (§3.1).
  try {
    const relationship = await service.deleteRelationship(scope(c), c.req.param('id'));
    if (!relationship) return err(c, 'NOT_FOUND', 'Relationship not found', 404);
    return ok(c, { id: relationship.id });
  } catch (e: unknown) {
    if (e instanceof Error && e.message === NOT_OWNER) {
      return err(c, 'FORBIDDEN', 'Only the owner may delete a private or shared item', 403);
    }
    throw e;
  }
});
