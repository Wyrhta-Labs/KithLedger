import { Hono } from 'hono';
import { requireAuth } from '../middleware/auth.js';
import * as service from '../services/people.js';
import { createPersonSchema, updatePersonSchema, listPeopleQuerySchema } from '../validators/people.js';
import { ok, err } from '../lib/response.js';

export const peopleRouter = new Hono();

peopleRouter.use('*', requireAuth);

peopleRouter.get('/', async (c) => {
  const query = listPeopleQuerySchema.safeParse(c.req.query());
  if (!query.success) return err(c, 'VALIDATION_ERROR', 'Invalid query parameters', 400);

  const { rows, total, limit, offset } = await service.listPeople(query.data);
  return ok(c, rows, { total, limit, offset });
});

peopleRouter.post('/', async (c) => {
  const body = createPersonSchema.safeParse(await c.req.json());
  if (!body.success) return err(c, 'VALIDATION_ERROR', 'Invalid request body', 400);

  const person = await service.createPerson(body.data);
  return ok(c, person, undefined, 201);
});

peopleRouter.get('/:id', async (c) => {
  const person = await service.getPerson(c.req.param('id'));
  if (!person) return err(c, 'NOT_FOUND', 'Person not found', 404);
  return ok(c, person);
});

peopleRouter.patch('/:id', async (c) => {
  const body = updatePersonSchema.safeParse(await c.req.json());
  if (!body.success) return err(c, 'VALIDATION_ERROR', 'Invalid request body', 400);

  const person = await service.updatePerson(c.req.param('id'), body.data);
  if (!person) return err(c, 'NOT_FOUND', 'Person not found', 404);
  return ok(c, person);
});

peopleRouter.delete('/:id', async (c) => {
  const person = await service.deletePerson(c.req.param('id'));
  if (!person) return err(c, 'NOT_FOUND', 'Person not found', 404);
  return ok(c, { id: person.id });
});
