import { Hono } from 'hono';
import { requireAuth } from '../middleware/auth.js';
import * as service from '../services/interactions.js';
import { createInteractionSchema, updateInteractionSchema, listInteractionsQuerySchema } from '../validators/interactions.js';
import { ok, err } from '../lib/response.js';

export const interactionsRouter = new Hono();

interactionsRouter.use('*', requireAuth);

interactionsRouter.get('/', async (c) => {
  const query = listInteractionsQuerySchema.safeParse(c.req.query());
  if (!query.success) return err(c, 'VALIDATION_ERROR', 'Invalid query parameters', 400);

  const { rows, total, limit, offset } = await service.listInteractions(query.data);
  return ok(c, rows, { total, limit, offset });
});

interactionsRouter.post('/', async (c) => {
  const body = createInteractionSchema.safeParse(await c.req.json());
  if (!body.success) return err(c, 'VALIDATION_ERROR', 'Invalid request body', 400);

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
  if (!body.success) return err(c, 'VALIDATION_ERROR', 'Invalid request body', 400);

  const interaction = await service.updateInteraction(c.req.param('id'), body.data);
  if (!interaction) return err(c, 'NOT_FOUND', 'Interaction not found', 404);
  return ok(c, interaction);
});

interactionsRouter.delete('/:id', async (c) => {
  const interaction = await service.deleteInteraction(c.req.param('id'));
  if (!interaction) return err(c, 'NOT_FOUND', 'Interaction not found', 404);
  return ok(c, { id: interaction.id });
});
