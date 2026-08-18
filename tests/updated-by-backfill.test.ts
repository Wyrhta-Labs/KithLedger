import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { readFileSync, readdirSync } from 'node:fs';
import { randomUUID } from 'node:crypto';
import postgres from 'postgres';
import { config } from '../src/config/env.js';

/**
 * Migration 0007 (`updated_by`) against a database that already holds rows.
 *
 * Same method as `visibility-backfill.test.ts`, and for the same reason: the
 * interesting question about a schema change is never what it does to an empty
 * table. Here the claim under test is a NEGATIVE one — that 0007 invents no
 * provenance — and a negative claim is exactly the kind that rots silently if
 * nobody pins it, because "add a sensible backfill" looks like an improvement
 * to anyone reading the migration later without the argument.
 *
 * Replays the real 0000..0007 in a throwaway SCHEMA (the test role has no
 * CREATEDB), with pre-existing rows written the way the pre-B5 deployment did.
 */

const SCHEMA = `b9_updated_by_${randomUUID().replace(/-/g, '').slice(0, 12)}`;
const MIGRATIONS = 'src/db/migrations';

const sql = postgres(config.databaseUrl, { max: 1, onnotice: () => {} });

function statements(tag: string): string[] {
  const file = readdirSync(MIGRATIONS).find((f) => f.startsWith(tag) && f.endsWith('.sql'));
  if (!file) throw new Error(`no migration file for ${tag}`);
  return readFileSync(`${MIGRATIONS}/${file}`, 'utf8')
    .replaceAll('"public".', `"${SCHEMA}".`)
    .split('--> statement-breakpoint')
    .map((s) => s.trim())
    .filter((s) => s.length > 0);
}

async function apply(tag: string) {
  for (const statement of statements(tag)) await sql.unsafe(statement);
}

const adminId = randomUUID();
const memberId = randomUUID();
let personIds: string[] = [];

const TABLES = ['people', 'interactions', 'relationships', 'reminders'] as const;

beforeAll(async () => {
  await sql.unsafe(`DROP SCHEMA IF EXISTS "${SCHEMA}" CASCADE`);
  await sql.unsafe(`CREATE SCHEMA "${SCHEMA}"`);
  await sql.unsafe(`SET search_path TO "${SCHEMA}", public`);

  for (const tag of ['0000', '0001', '0002', '0003']) await apply(tag);

  await sql`INSERT INTO users (id, email, handle, password_hash, role, created_at)
            VALUES (${adminId}, 'admin@x.invalid', 'admin', 'argon2ish', 'admin', '2024-01-01T00:00:00Z')`;
  await sql`INSERT INTO users (id, email, handle, password_hash, role, created_at)
            VALUES (${memberId}, 'heorth@x.invalid', 'heorth-x', '!', 'adult', '2025-01-01T00:00:00Z')`;
  await sql`INSERT INTO household_members (user_id) VALUES (${memberId})`;

  const rows = await sql<{ id: string }[]>`
    INSERT INTO people (name) VALUES ('Ada'), ('Grace') RETURNING id`;
  personIds = rows.map((r) => r.id);
  await sql`INSERT INTO interactions (person_id, occurred_at, type)
            VALUES (${personIds[0]!}, now(), 'call')`;
  await sql`INSERT INTO relationships (from_person_id, to_person_id, type)
            VALUES (${personIds[0]!}, ${personIds[1]!}, 'friend')`;
  await sql`INSERT INTO reminders (person_id, due_at, title)
            VALUES (${personIds[0]!}, now(), 'call back')`;

  // B5, B6, B8, then B9.
  for (const tag of ['0004', '0005', '0006', '0007']) await apply(tag);
}, 60_000);

afterAll(async () => {
  await sql.unsafe(`DROP SCHEMA IF EXISTS "${SCHEMA}" CASCADE`);
  await sql.end();
});

describe('migration 0007 (updated_by) against a database that already holds rows', () => {
  it.each(TABLES)('leaves every pre-existing %s row unattributed', async (table) => {
    const rows = await sql<{ updated_by: string | null; owner_id: string }[]>`
      SELECT updated_by, owner_id FROM ${sql(table)}`;
    expect(rows.length).toBeGreaterThan(0);
    // NULL = "not recorded", which is the truth. In particular it is NOT
    // `owner_id`: asserting that the owner was the last writer is the one
    // claim this column exists to be able to disprove, and 0005 already put a
    // real owner on every one of these rows, so the temptation is right there.
    expect(rows.every((r) => r.updated_by === null)).toBe(true);
    expect(rows.every((r) => r.owner_id === adminId)).toBe(true);
  });

  it('is trivially idempotent — 0007 carries no data statement to re-run', () => {
    const code = statements('0007').map((statement) =>
      statement
        .split(/\r?\n/)
        .filter((line) => !line.trimStart().startsWith('--'))
        .join('\n')
        .trim()
        .toUpperCase(),
    );
    expect(code.length).toBeGreaterThan(0);
    // Pure DDL. 0004 and 0005 each carry a hand-written UPDATE; this one
    // carries none, and "re-running it changes nothing" is therefore true by
    // there being nothing to re-run.
    expect(code.every((statement) => statement.startsWith('ALTER TABLE '))).toBe(true);
  });

  it('records the writer for rows written after the migration', async () => {
    const [row] = await sql<{ updated_by: string | null }[]>`
      INSERT INTO people (name, owner_id, updated_by)
      VALUES ('Post-migration', ${memberId}, ${memberId}) RETURNING updated_by`;
    expect(row!.updated_by).toBe(memberId);
  });

  it('drops the stamp to NULL when the writer is deleted, and keeps the row', async () => {
    // ON DELETE SET NULL, not RESTRICT: a member who owns nothing but once
    // edited somebody else's row must not be undeletable, or offboarding could
    // only finish by rewriting history. And not CASCADE, obviously: the
    // household's data does not evaporate because an editor left.
    const editorId = randomUUID();
    await sql`INSERT INTO users (id, email, handle, password_hash, role)
              VALUES (${editorId}, 'ed@x.invalid', 'heorth-ed', '!', 'adult')`;
    await sql`INSERT INTO household_members (user_id) VALUES (${editorId})`;
    await sql`UPDATE people SET updated_by = ${editorId} WHERE id = ${personIds[0]!}`;

    await sql`DELETE FROM users WHERE id = ${editorId}`;

    const [row] = await sql<{ updated_by: string | null; name: string }[]>`
      SELECT updated_by, name FROM people WHERE id = ${personIds[0]!}`;
    expect(row!.name).toBe('Ada');
    expect(row!.updated_by).toBeNull();
  });

  it('still refuses to delete a user who OWNS rows (owner_id stays RESTRICT)', async () => {
    await expect(sql`DELETE FROM users WHERE id = ${adminId}`).rejects.toThrow(
      /people_owner_id_users_id_fk/,
    );
  });
});
