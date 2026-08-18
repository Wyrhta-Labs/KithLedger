import { pgTable, uuid, text, timestamp, check } from 'drizzle-orm/pg-core';
import { sql } from 'drizzle-orm';
import { apiKeys } from '@wyrhta/core/identity';

/**
 * ADR 0004 §2 — the three kinds of caller, made into three SEPARATE
 * credentials (task B8).
 *
 * B6 made the household scope expressible (`HOUSEHOLD_SCOPE`) but nothing
 * could resolve to it: every credential that reached a route was a member
 * principal. This table is what makes a `kl_` key SAY which of the ADR's three
 * principals it is, so the answer is a property of the credential itself and
 * never an inference from what the caller happens to ask for.
 *
 * ── WHY A SIDE TABLE AND NOT A COLUMN ON `api_keys` ──────────────────────────
 *
 * `api_keys` is `@wyrhta/core`'s table, shared by every service on the
 * foundation (ADR 0006). ADR 0004's three-principal split is KithLedger's
 * access-control model, not the foundation's; adding a column to a table this
 * repo does not own would either fork core's schema or make `drizzle-kit`
 * generate a DROP COLUMN the next time core's definition is regenerated. A
 * side table keyed by `api_keys.id` is additive, cascades with the key it
 * describes, and leaves core's table byte-identical across services.
 *
 * ── WHY NO ROW MEANS "REFUSE", NOT "MEMBER" ──────────────────────────────────
 *
 * A missing row could default to `member`, and every key that existed before
 * B8 IS a member key — `0006_*.sql` backfills exactly that. But defaulting at
 * READ time means the elevated kinds degrade the wrong way: delete a
 * household key's row and it silently widens from "the household slice" to
 * "the full personal scope of the local admin who created it". A key with no
 * row is therefore refused (401), so the failure mode of losing this table is
 * a dead credential rather than an over-privileged one.
 */
export const CREDENTIAL_KINDS = ['member', 'household', 'ops'] as const;
export type CredentialKind = (typeof CREDENTIAL_KINDS)[number];

/** What a `kl_` key gets when nothing else is asked for: today's behaviour. */
export const DEFAULT_CREDENTIAL_KIND: CredentialKind = 'member';

/**
 * Which of ADR 0004 §2's three principals a given `kl_` key is.
 *
 * The CHECK constraint follows how this repo already constrains enum-ish text
 * columns (`visibility`, `type`, `status`) — a CHECK on `text` rather than a
 * pg enum type, which cannot have values removed.
 */
export const apiKeyCredentials = pgTable('api_key_credentials', {
  /** The key this describes. One row per key, gone when the key is. */
  keyId: uuid('key_id')
    .primaryKey()
    .references(() => apiKeys.id, { onDelete: 'cascade' }),
  /** `member` | `household` | `ops` — see {@link CREDENTIAL_KINDS}. */
  kind: text('kind').notNull().default(DEFAULT_CREDENTIAL_KIND).$type<CredentialKind>(),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().default(sql`now()`),
}, (table) => [
  check('api_key_credentials_kind_check', sql`${table.kind} IN ('member', 'household', 'ops')`),
]);

export type ApiKeyCredential = typeof apiKeyCredentials.$inferSelect;
export type NewApiKeyCredential = typeof apiKeyCredentials.$inferInsert;
