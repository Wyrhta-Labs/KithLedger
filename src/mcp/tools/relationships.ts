import type { McpTool, McpToolResult, McpToolContext } from '@wyrhta/core/mcp';
import { memberScope } from '../../services/scope.js';
import * as relationshipsService from '../../services/relationships.js';
import { createRelationshipSchema, listRelationshipsQuerySchema } from '../../validators/relationships.js';

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

export const relationshipTools: McpTool[] = [
  {
    name: 'kith.list_relationships',
    description: 'List relationships, optionally filtered by person or type.',
    inputSchema: listRelationshipsQuerySchema.shape,
    async handler(ctx, input) {
      const query = listRelationshipsQuerySchema.parse(input ?? {});
      const { rows, total, limit, offset } = await relationshipsService.listRelationships(scope(ctx), query);
      return ok({ items: rows, total, limit, offset });
    },
  },
  {
    name: 'kith.create_relationship',
    description: 'Create a relationship between two people.',
    // createRelationshipSchema is wrapped in .refine(...), which produces a ZodEffects
    // rather than a ZodObject, so .shape is undefined on it directly. Reach into the
    // inner object schema (._def.schema) for the raw shape used by the MCP inputSchema,
    // while still parsing with the full createRelationshipSchema below so the
    // self-relationship refine check is enforced.
    inputSchema: createRelationshipSchema._def.schema.shape,
    async handler(ctx, input) {
      const data = createRelationshipSchema.parse(input);
      try {
        const relationship = await relationshipsService.createRelationship(scope(ctx), data);
        return ok(relationship);
      } catch (err) {
        if (err instanceof Error && (err.message === 'FROM_PERSON_NOT_FOUND' || err.message === 'TO_PERSON_NOT_FOUND')) {
          throw new Error('NOT_FOUND');
        }
        if (err instanceof Error && err.message === 'RELATIONSHIP_EXISTS') {
          throw new Error('CONFLICT');
        }
        throw err;
      }
    },
  },
];
