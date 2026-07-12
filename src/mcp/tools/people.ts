import { z } from 'zod';
import type { McpTool, McpToolResult } from '@wyrhta/core/mcp';
import * as peopleService from '../../services/people.js';
import { getPersonGraph } from '../../services/relationships.js';
import { createPersonSchema, updatePersonSchema, listPeopleQuerySchema } from '../../validators/people.js';

function ok(data: unknown): McpToolResult {
  return { content: [{ type: 'text', text: JSON.stringify(data) }] };
}

export const peopleTools: McpTool[] = [
  {
    name: 'kith.list_people',
    description: 'List people, optionally filtered by search, tags, or birthday month.',
    inputSchema: listPeopleQuerySchema.shape,
    async handler(_ctx, input) {
      const query = listPeopleQuerySchema.parse(input ?? {});
      const { rows, total, limit, offset } = await peopleService.listPeople(query);
      return ok({ items: rows, total, limit, offset });
    },
  },
  {
    name: 'kith.get_person',
    description: 'Get a single person by id.',
    inputSchema: { id: z.string().uuid() },
    async handler(_ctx, input) {
      const { id } = z.object({ id: z.string().uuid() }).parse(input);
      const person = await peopleService.getPerson(id);
      if (!person) throw new Error('NOT_FOUND');
      return ok(person);
    },
  },
  {
    name: 'kith.create_person',
    description: 'Create a new person.',
    inputSchema: createPersonSchema.shape,
    async handler(_ctx, input) {
      const data = createPersonSchema.parse(input);
      const person = await peopleService.createPerson(data);
      return ok(person);
    },
  },
  {
    name: 'kith.update_person',
    description: 'Update an existing person.',
    inputSchema: { id: z.string().uuid(), ...updatePersonSchema.shape },
    async handler(_ctx, input) {
      const { id } = z.object({ id: z.string().uuid() }).parse(input);
      const data = updatePersonSchema.parse(input);
      const person = await peopleService.updatePerson(id, data);
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
    async handler(_ctx, input) {
      const { id, depth } = z
        .object({ id: z.string().uuid(), depth: z.coerce.number().int().min(1).max(3).optional().default(1) })
        .parse(input);
      const graph = await getPersonGraph(id, depth);
      if (!graph) throw new Error('NOT_FOUND');
      return ok(graph);
    },
  },
];
