import { Hono } from 'hono';
import { requireAuth } from '../identity.js';
import * as service from '../services/relationships.js';
import { createRelationshipSchema, updateRelationshipSchema, listRelationshipsQuerySchema, graphQuerySchema } from '../validators/relationships.js';
import { ok, err } from '@wyrhta/core/http';

export const relationshipsRouter = new Hono();

relationshipsRouter.use('*', requireAuth);

relationshipsRouter.get('/', async (c) => {
  const query = listRelationshipsQuerySchema.safeParse(c.req.query());
  if (!query.success) return err(c, 'VALIDATION_ERROR', 'Invalid query parameters', 400);

  const { rows, total, limit, offset } = await service.listRelationships(query.data);
  return ok(c, rows, { total, limit, offset });
});

relationshipsRouter.post('/', async (c) => {
  const body = createRelationshipSchema.safeParse(await c.req.json());
  if (!body.success) return err(c, 'VALIDATION_ERROR', 'Invalid request body', 400);

  try {
    const relationship = await service.createRelationship(body.data);
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
  const relationship = await service.getRelationship(c.req.param('id'));
  if (!relationship) return err(c, 'NOT_FOUND', 'Relationship not found', 404);
  return ok(c, relationship);
});

relationshipsRouter.patch('/:id', async (c) => {
  const body = updateRelationshipSchema.safeParse(await c.req.json());
  if (!body.success) return err(c, 'VALIDATION_ERROR', 'Invalid request body', 400);

  const relationship = await service.updateRelationship(c.req.param('id'), body.data);
  if (!relationship) return err(c, 'NOT_FOUND', 'Relationship not found', 404);
  return ok(c, relationship);
});

relationshipsRouter.delete('/:id', async (c) => {
  const relationship = await service.deleteRelationship(c.req.param('id'));
  if (!relationship) return err(c, 'NOT_FOUND', 'Relationship not found', 404);
  return ok(c, { id: relationship.id });
});
