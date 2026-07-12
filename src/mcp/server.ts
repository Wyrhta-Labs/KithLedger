import { createMcpServer } from '@wyrhta/core/mcp';
import { kithTools } from './registry.js';
import { mcpAuthAdapter } from './auth.js';

export function createKithMcpServer() {
  return createMcpServer(kithTools, mcpAuthAdapter, { name: 'kithledger', version: '0.1.0' });
}
