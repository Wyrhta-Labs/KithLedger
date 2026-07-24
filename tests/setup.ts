import { beforeAll, afterAll, beforeEach } from 'vitest';
import { migrate } from 'drizzle-orm/postgres-js/migrator';
import { db } from '../src/db/index.js';

// The .env auto-loader (src/config/env.ts) fills DATABASE_URL when it isn't
// exported. This destructive suite truncates tables — refuse dev databases.
if ((process.env['DATABASE_URL'] ?? '').includes('_dev')) {
  throw new Error(
    'Refusing to run tests against a _dev database — export a dedicated test DATABASE_URL.',
  );
}
import { people, interactions, reminders, relationships, apiKeys, users } from '../src/db/schema/index.js';

beforeAll(async () => {
  await migrate(db, { migrationsFolder: './src/db/migrations' });
});

beforeEach(async () => {
  // Clean tables in FK-safe order (api_keys references users; domain tables reference people)
  await db.delete(interactions);
  await db.delete(reminders);
  await db.delete(relationships);
  await db.delete(people);
  await db.delete(apiKeys);
  await db.delete(users);
});
