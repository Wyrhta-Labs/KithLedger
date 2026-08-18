import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { readFileSync, readdirSync } from 'node:fs';
import { randomUUID } from 'node:crypto';
import postgres from 'postgres';
import { config } from '../src/config/env.js';

/**
 * The 0004 BACKFILL, applied to a database that already holds rows.
 *
 * Testing the migration against an empty schema would prove nothing: the
 * whole risk of B5 is what happens to the data that is already there. Either
 * it silently disappears from the UI the moment B6 turns enforcement on, or
 * it is marked as somebody's private data when it never was. So this replays
 * the REAL migration files 0000..0003, writes pre-existing rows the way the
 * single-admin deployment did, and only then applies the real 0004.
 *
 * It runs in a throwaway Postgres SCHEMA rather than a throwaway database,
 * because the test role has no CREATEDB. The only edit made to the shipped
 * SQL is requalifying `"public".` — every statement is otherwise byte-for-byte
 * what production will run.
 */

const SCHEMA = `b5_backfill_${randomUUID().replace(/-/g, '').slice(0, 12)}`;
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

beforeAll(async () => {
  await sql.unsafe(`DROP SCHEMA IF EXISTS "${SCHEMA}" CASCADE`);
  await sql.unsafe(`CREATE SCHEMA "${SCHEMA}"`);
  // max: 1, so this one connection is the one every later query runs on.
  await sql.unsafe(`SET search_path TO "${SCHEMA}", public`);

  // --- the world as it stands before B5 ---
  await apply('0000');
  await apply('0001');
  await apply('0002');
  await apply('0003');

  // A Heorth-authored member, provisioned FIRST, i.e. with the oldest
  // created_at of any user. If the backfill were "just take the oldest user"
  // it would pick this row; B4's rule is "the users row with no
  // household_members row is the local admin", and that is what must decide.
  await sql`INSERT INTO users (id, email, handle, password_hash, role, created_at)
            VALUES (${memberId}, 'heorth@x.invalid', 'heorth-x', '!', 'adult', '2020-01-01T00:00:00Z')`;
  await sql`INSERT INTO household_members (user_id) VALUES (${memberId})`;
  await sql`INSERT INTO users (id, email, handle, password_hash, role, created_at)
            VALUES (${adminId}, 'admin@x.invalid', 'admin', 'argon2ish', 'admin', '2024-01-01T00:00:00Z')`;

  const rows = await sql<{ id: string }[]>`
    INSERT INTO people (name) VALUES ('Ada'), ('Grace') RETURNING id`;
  personIds = rows.map((r) => r.id);
  await sql`INSERT INTO interactions (person_id, occurred_at, type)
            VALUES (${personIds[0]!}, now(), 'call')`;
  await sql`INSERT INTO relationships (from_person_id, to_person_id, type)
            VALUES (${personIds[0]!}, ${personIds[1]!}, 'friend')`;
  await sql`INSERT INTO reminders (person_id, due_at, title)
            VALUES (${personIds[0]!}, now(), 'call back')`;

  // --- B5 lands ---
  await apply('0004');
}, 60_000);

afterAll(async () => {
  await sql.unsafe(`DROP SCHEMA IF EXISTS "${SCHEMA}" CASCADE`);
  await sql.end();
});

const TABLES = ['people', 'interactions', 'relationships', 'reminders'] as const;

describe('migration 0004 against a database that already holds rows', () => {
  it.each(TABLES)('marks every pre-existing %s row household', async (table) => {
    const rows = await sql<{ visibility: string }[]>`SELECT visibility FROM ${sql(table)}`;
    expect(rows.length).toBeGreaterThan(0);
    expect(rows.every((r) => r.visibility === 'household')).toBe(true);
    // This is what "preserves today's observable behaviour" means: the
    // service has been single-account, so every existing row was readable by
    // every caller. `household` is the only value that keeps that true once
    // B6 filters — and unlike a materialised share list it keeps it true for
    // members who join later, too.
  });

  it.each(TABLES)('gives every pre-existing %s row the LOCAL ADMIN as owner', async (table) => {
    const rows = await sql<{ owner_id: string | null }[]>`SELECT owner_id FROM ${sql(table)}`;
    expect(rows.length).toBeGreaterThan(0);
    expect(rows.every((r) => r.owner_id === adminId)).toBe(true);
    // Not the member, even though the member is the older users row: every
    // pre-B5 write went through the admin account, the only credential that
    // could reach a write endpoint before member tokens existed. Handing
    // ownership to a member would hand them ADR 0004 §4 mutation rights over
    // data they never authored.
    expect(rows.some((r) => r.owner_id === memberId)).toBe(false);
  });

  it('leaves no row unowned', async () => {
    for (const table of TABLES) {
      const [row] = await sql<{ n: number }[]>`
        SELECT count(*)::int AS n FROM ${sql(table)} WHERE owner_id IS NULL`;
      expect(row!.n).toBe(0);
    }
  });

  it('is idempotent — re-running the backfill changes nothing', async () => {
    const before = await sql<{ owner_id: string }[]>`SELECT owner_id FROM people ORDER BY id`;
    for (const statement of statements('0004')) {
      if (statement.includes('UPDATE "people" SET "owner_id"')) await sql.unsafe(statement);
    }
    const after = await sql<{ owner_id: string }[]>`SELECT owner_id FROM people ORDER BY id`;
    expect(after).toEqual(before);
  });

  it('still refuses to delete the admin, who now owns everything (ADR 0004 §4)', async () => {
    await expect(sql`DELETE FROM users WHERE id = ${adminId}`).rejects.toThrow(
      /people_owner_id_users_id_fk/,
    );
  });

  it('defaults rows created after the migration to household', async () => {
    const [row] = await sql<{ visibility: string; owner_id: string | null }[]>`
      INSERT INTO people (name) VALUES ('Post-migration') RETURNING visibility, owner_id`;
    expect(row!.visibility).toBe('household');
    // Inert until B6: nothing stamps an owner yet, which is why owner_id is
    // still nullable. B6 sets it from the principal and then tightens it.
    expect(row!.owner_id).toBeNull();
  });

  it('created all four share tables', async () => {
    const rows = await sql<{ table_name: string }[]>`
      SELECT table_name FROM information_schema.tables
      WHERE table_schema = ${SCHEMA} AND table_name LIKE '%_shares' ORDER BY table_name`;
    expect(rows.map((r) => r.table_name)).toEqual([
      'interaction_shares',
      'person_shares',
      'relationship_shares',
      'reminder_shares',
    ]);
  });
});
