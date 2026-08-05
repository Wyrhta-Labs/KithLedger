import { Hono } from 'hono';
import { requireAuth } from '../identity.js';
import * as service from '../services/interactions.js';
import { createInteractionSchema, updateInteractionSchema, listInteractionsQuerySchema } from '../validators/interactions.js';
import { ok, err } from '@wyrhta/core/http';
import { validationError } from '../lib/validation.js';

export const interactionsRouter = new Hono();

interactionsRouter.use('*', requireAuth);

interactionsRouter.get('/', async (c) => {
  const query = listInteractionsQuerySchema.safeParse(c.req.query());
  if (!query.success) return validationError(c, query.error, 'query parameters');

  const { rows, total, limit, offset } = await service.listInteractions(query.data);
  return ok(c, rows, { total, limit, offset });
});

interactionsRouter.post('/', async (c) => {
  const body = createInteractionSchema.safeParse(await c.req.json());
  if (!body.success) return validationError(c, body.error);

  try {
    const interaction = await service.createInteraction(body.data);
    return ok(c, interaction, undefined, 201);
  } catch (e: unknown) {
    if (e instanceof Error && e.message === 'PERSON_NOT_FOUND') {
      return err(c, 'NOT_FOUND', 'Person not found', 404);
    }
    throw e;
  }
});

interactionsRouter.get('/:id', async (c) => {
  const interaction = await service.getInteraction(c.req.param('id'));
  if (!interaction) return err(c, 'NOT_FOUND', 'Interaction not found', 404);
  return ok(c, interaction);
});

interactionsRouter.patch('/:id', async (c) => {
  const body = updateInteractionSchema.safeParse(await c.req.json());
  if (!body.success) return validationError(c, body.error);

  const interaction = await service.updateInteraction(c.req.param('id'), body.data);
  if (!interaction) return err(c, 'NOT_FOUND', 'Interaction not found', 404);
  return ok(c, interaction);
});

interactionsRouter.delete('/:id', async (c) => {
  const interaction = await service.deleteInteraction(c.req.param('id'));
  if (!interaction) return err(c, 'NOT_FOUND', 'Interaction not found', 404);
  return ok(c, { id: interaction.id });
});
