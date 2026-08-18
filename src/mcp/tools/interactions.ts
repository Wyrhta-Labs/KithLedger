import type { McpTool, McpToolResult, McpToolContext } from '@wyrhta/core/mcp';
import { memberScope } from '../../services/scope.js';
import * as interactionsService from '../../services/interactions.js';
import { createInteractionSchema, listInteractionsQuerySchema } from '../../validators/interactions.js';

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

export const interactionTools: McpTool[] = [
  {
    name: 'kith.list_interactions',
    description: 'List interactions, optionally filtered by person, type, or date range.',
    inputSchema: listInteractionsQuerySchema.shape,
    async handler(ctx, input) {
      const query = listInteractionsQuerySchema.parse(input ?? {});
      const { rows, total, limit, offset } = await interactionsService.listInteractions(scope(ctx), query);
      return ok({ items: rows, total, limit, offset });
    },
  },
  {
    name: 'kith.log_interaction',
    description: 'Log a new interaction with a person.',
    inputSchema: createInteractionSchema.shape,
    async handler(ctx, input) {
      const data = createInteractionSchema.parse(input);
      try {
        const interaction = await interactionsService.createInteraction(scope(ctx), data);
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
