import { migrate } from 'drizzle-orm/postgres-js/migrator';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { db } from '../db/index.js';
import { seedAdmin } from '../identity.js';
import { createKithMcpServer } from './server.js';

async function main() {
  await migrate(db, { migrationsFolder: './src/db/migrations' });
  await seedAdmin();

  const server = createKithMcpServer();
  const transport = new StdioServerTransport();
  await server.connect(transport);
}

main().catch((err) => {
  console.error('Fatal error during MCP startup:', err);
  process.exit(1);
});
