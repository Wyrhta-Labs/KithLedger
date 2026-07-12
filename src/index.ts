import { serve } from '@hono/node-server';
import { migrate } from 'drizzle-orm/postgres-js/migrator';
import { db } from './db/index.js';
import { createApp } from './app.js';
import { config } from './config/env.js';
import { seedAdmin } from './identity.js';

async function main() {
  console.log('Running database migrations...');
  await migrate(db, { migrationsFolder: './src/db/migrations' });
  console.log('Migrations complete.');

  console.log('Seeding admin user (idempotent)...');
  await seedAdmin();
  console.log('Admin user ready.');

  const app = createApp();

  serve(
    {
      fetch: app.fetch,
      port: config.port,
    },
    (info) => {
      console.log(`KithLedger API running on http://localhost:${info.port}`);
    }
  );
}

main().catch((err) => {
  console.error('Fatal error during startup:', err);
  process.exit(1);
});
