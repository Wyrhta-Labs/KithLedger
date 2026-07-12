import type { McpTool, McpToolResult } from '@wyrhta/core/mcp';
import * as interactionsService from '../../services/interactions.js';
import { createInteractionSchema, listInteractionsQuerySchema } from '../../validators/interactions.js';

function ok(data: unknown): McpToolResult {
  return { content: [{ type: 'text', text: JSON.stringify(data) }] };
}

export const interactionTools: McpTool[] = [
  {
    name: 'kith.list_interactions',
    description: 'List interactions, optionally filtered by person, type, or date range.',
    inputSchema: listInteractionsQuerySchema.shape,
    async handler(_ctx, input) {
      const query = listInteractionsQuerySchema.parse(input ?? {});
      const { rows, total, limit, offset } = await interactionsService.listInteractions(query);
      return ok({ items: rows, total, limit, offset });
    },
  },
  {
    name: 'kith.log_interaction',
    description: 'Log a new interaction with a person.',
    inputSchema: createInteractionSchema.shape,
    async handler(_ctx, input) {
      const data = createInteractionSchema.parse(input);
      try {
        const interaction = await interactionsService.createInteraction(data);
        return ok(interaction);
      } catch (err) {
        if (err instanceof Error && err.message === 'PERSON_NOT_FOUND') {
          throw new Error('NOT_FOUND');
        }
        throw err;
      }
    },
  },
];
