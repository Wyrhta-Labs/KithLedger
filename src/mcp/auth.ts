import type { AuthAdapter, McpPrincipal } from '@wyrhta/core/mcp';
import { logEvent } from '@wyrhta/core/lib';
import { config } from '../config/env.js';
import { identity } from '../identity.js';
import { credentialOf } from '../services/credentials.js';

/**
 * Builds an MCP {@link AuthAdapter} that resolves a `kl_`-prefixed API key
 * (obtained via `getCredential`) to the authenticated principal. Factored as
 * a factory so tests can supply a controllable credential source instead of
 * mutating `process.env`.
 */
export function createMcpAuthAdapter(getCredential: () => string | undefined): AuthAdapter {
  return {
    async resolve(): Promise<McpPrincipal> {
      const cred = getCredential();
      if (!cred || !cred.startsWith('kl_')) {
        logEvent({ event: 'mcp.auth.rejected', auth_type: 'api_key', success: false });
        throw new Error('MCP_UNAUTHORIZED');
      }
      const principal = await identity.validateApiKey(cred);
      if (!principal) {
        logEvent({ event: 'mcp.auth.rejected', auth_type: 'api_key', success: false });
        throw new Error('MCP_UNAUTHORIZED');
      }
      // B8 (ADR 0004 §2): the MCP tools resolve their caller to a MEMBER scope
      // (`memberScope(ctx.principal.userId)`), and `McpPrincipal` has no room
      // for the credential kind. So a household or ops key presented here would
      // silently be read as the personal scope of the account that issued it —
      // precisely the widening the three separate credentials exist to prevent.
      // Refuse anything but a member key rather than paper over that.
      if (credentialOf(principal) !== 'member') {
        logEvent({
          event: 'mcp.auth.rejected',
          auth_type: 'api_key',
          success: false,
          user_id: principal.userId,
        });
        throw new Error('MCP_UNAUTHORIZED');
      }
      logEvent({
        event: 'mcp.auth.accepted',
        auth_type: 'api_key',
        success: true,
        user_id: principal.userId,
      });
      return { userId: principal.userId, role: principal.role };
    },
  };
}

/** Default adapter: reads the `kl_` key from the validated env config. */
export const mcpAuthAdapter: AuthAdapter = createMcpAuthAdapter(() => config.mcpApiKey);
