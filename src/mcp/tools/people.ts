import { z } from 'zod';
import type { McpTool, McpToolResult, McpToolContext } from '@wyrhta/core/mcp';
import { memberScope } from '../../services/scope.js';
import * as peopleService from '../../services/people.js';
import { getPersonGraph } from '../../services/relationships.js';
import { createPersonSchema, updatePersonSchema, listPeopleQuerySchema } from '../../validators/people.js';

function ok(data: unknown): McpToolResult {
  return { content: [{ type: 'text', text: JSON.stringify(data) }] };
}

/**
 * The MCP surface is being deleted in task A8 (heorth-mcp replaces it, ADR
 * 0008), so B6 does the MINIMUM here: the handlers stop discarding their
 * context and resolve the calling principal to a member scope, exactly as the
 * REST routes do. There is no MCP-specific access-control design in this file
 * and there should not be one — the enforcement lives in `src/services/`, and
 * this is only the seam that hands it a caller.
 */
const scope = (ctx: McpToolContext) => memberScope(ctx.principal.userId);

export const peopleTools: McpTool[] = [
  {
    name: 'kith.list_people',
    description: 'List people, optionally filtered by search, tags, or birthday month.',
    inputSchema: listPeopleQuerySchema.shape,
    async handler(ctx, input) {
      const query = listPeopleQuerySchema.parse(input ?? {});
      const { rows, total, limit, offset } = await peopleService.listPeople(scope(ctx), query);
      return ok({ items: rows, total, limit, offset });
    },
  },
  {
    name: 'kith.get_person',
    description: 'Get a single person by id.',
    inputSchema: { id: z.string().uuid() },
    async handler(ctx, input) {
      const { id } = z.object({ id: z.string().uuid() }).parse(input);
      const person = await peopleService.getPerson(scope(ctx), id);
      if (!person) throw new Error('NOT_FOUND');
      return ok(person);
    },
  },
  {
    name: 'kith.create_person',
    description: 'Create a new person.',
    inputSchema: createPersonSchema.shape,
    async handler(ctx, input) {
      const data = createPersonSchema.parse(input);
      const person = await peopleService.createPerson(scope(ctx), data);
      return ok(person);
    },
  },
  {
    name: 'kith.update_person',
    description: 'Update an existing person.',
    inputSchema: { id: z.string().uuid(), ...updatePersonSchema.shape },
    async handler(ctx, input) {
      const { id } = z.object({ id: z.string().uuid() }).parse(input);
      const data = updatePersonSchema.parse(input);
      const person = await peopleService.updatePerson(scope(ctx), id, data);
      if (!person) throw new Error('NOT_FOUND');
      return ok(person);
    },
  },
  {
    name: 'kith.get_person_graph',
    description: 'Get the relationship graph around a person.',
    inputSchema: {
      id: z.string().uuid(),
      depth: z.coerce.number().int().min(1).max(3).optional().default(1),
    },
    async handler(ctx, input) {
      const { id, depth } = z
        .object({ id: z.string().uuid(), depth: z.coerce.number().int().min(1).max(3).optional().default(1) })
        .parse(input);
      const graph = await getPersonGraph(id, depth);
      if (!graph) throw new Error('NOT_FOUND');
      return ok(graph);
    },
  },
];
