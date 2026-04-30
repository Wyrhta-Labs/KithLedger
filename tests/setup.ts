import { beforeAll, afterAll, beforeEach } from 'vitest';
import { migrate } from 'drizzle-orm/postgres-js/migrator';
import { db } from '../src/db/index.js';
import { people, interactions, reminders, relationships, apiKeys, settingValues, refreshTokens } from '../src/db/schema/index.js';
import { seedDefaultSettingValues } from '../src/services/setting-values.js';

beforeAll(async () => {
  await migrate(db, { migrationsFolder: './src/db/migrations' });
  await seedDefaultSettingValues();
});

beforeEach(async () => {
  // Clean tables in FK-safe order
  await db.delete(interactions);
  await db.delete(reminders);
  await db.delete(relationships);
  await db.delete(people);
  await db.delete(apiKeys);
  await db.delete(settingValues);
  await db.delete(refreshTokens);
  await seedDefaultSettingValues();
});
