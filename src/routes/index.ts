import { Hono } from 'hono';
import { healthRouter } from './health.js';
import { authRouter } from './auth.js';
import { peopleRouter } from './people.js';
import { interactionsRouter } from './interactions.js';
import { remindersRouter } from './reminders.js';
import { relationshipsRouter } from './relationships.js';
import * as relationshipService from '../services/relationships.js';
import { requireAuth } from '../identity.js';
import { graphQuerySchema } from '../validators/relationships.js';
import { ok, err } from '@wyrhta/core/http';
import { validationError } from '../lib/validation.js';

export function mountRoutes(app: Hono) {
  app.route('/', healthRouter);
  app.route('/api/v1/auth', authRouter);
  app.route('/api/v1/people', peopleRouter);
  app.route('/api/v1/interactions', interactionsRouter);
  app.route('/api/v1/reminders', remindersRouter);
  app.route('/api/v1/relationships', relationshipsRouter);

  // Graph endpoint nested under people
  app.get('/api/v1/people/:id/graph', requireAuth, async (c) => {
    const query = graphQuerySchema.safeParse(c.req.query());
    if (!query.success) return validationError(c, query.error, 'query parameters');

    const result = await relationshipService.getPersonGraph(c.req.param('id'), query.data.depth);
    if (!result) return err(c, 'NOT_FOUND', 'Person not found', 404);

    return ok(c, result, { root_person_id: c.req.param('id'), depth: query.data.depth });
  });
}
