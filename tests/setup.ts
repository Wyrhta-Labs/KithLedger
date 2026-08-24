import { beforeAll, afterAll, beforeEach } from 'vitest';
import { migrate } from 'drizzle-orm/postgres-js/migrator';
import { db } from '../src/db/index.js';
import { assertTestDatabase } from '@wyrhta/core/testing';

// Destructive-suite guard. This file deletes every row in every table between
// tests, so it must only ever run against a throwaway database. The allowlist
// (and why a denylist failed open) lives in @wyrhta/core/testing. The .env
// auto-loader (src/config/env.ts, reached via the `db` import above) fills
// DATABASE_URL when it isn't exported, so by here it holds the URL in force.
assertTestDatabase({ example: 'kithledger_test' });

import {
  people, interactions, reminders, relationships, apiKeys, householdMembers, users,
  personShares, interactionShares, relationshipShares, reminderShares, apiKeyCredentials,
} from '../src/db/schema/index.js';

beforeAll(async () => {
  await migrate(db, { migrationsFolder: './src/db/migrations' });
});

beforeEach(async () => {
  // Clean tables in FK-safe order (api_keys and household_members reference
  // users; domain tables reference people; the four *_shares tables reference
  // a domain table AND users; every domain table's owner_id references users
  // ON DELETE RESTRICT, so users must go last or the delete is refused)
  // Share rows first: they reference both the domain tables and users.
  await db.delete(personShares);
  await db.delete(interactionShares);
  await db.delete(relationshipShares);
  await db.delete(reminderShares);
  await db.delete(interactions);
  await db.delete(reminders);
  await db.delete(relationships);
  await db.delete(people);
  await db.delete(apiKeyCredentials);
  await db.delete(apiKeys);
  await db.delete(householdMembers);
  await db.delete(users);
});
