import { eq } from 'drizzle-orm';
import { logEvent } from '@wyrhta/core/lib';
import { userRole, type Role } from '@wyrhta/core/identity';
import { db } from '../db/index.js';
import { users, householdMembers } from '../db/schema/index.js';

/**
 * Just-in-time provisioning of Heorth-authored household members (task B4,
 * ADR 0002 phase B, ADR 0009).
 *
 * Members are authored in exactly ONE place: Heorth. KithLedger never becomes
 * a second source of truth for who the household is. A validly signed token
 * whose `sub` we have not seen creates the local record for that member on
 * that first request — no roster sync, no provisioning endpoint, no staleness
 * window. That coupling is what ADR 0007 cited when it deleted Feoh.
 *
 * ── THE DESIGN FORK, AND WHY IT WENT THIS WAY ────────────────────────────────
 *
 * A satellite token carries `sub` and `role` and nothing else — ADR 0009 fixes
 * that claim set, so widening it to carry an email was not on the table. Core's
 * `users` table, meanwhile, requires `email`, `handle` and `password_hash` NOT
 * NULL with `email`/`handle` UNIQUE. Two options:
 *
 *   (a) reuse core's `users`, synthesising the three columns; or
 *   (b) a separate table holding the member identity itself, leaving `users`
 *       to KithLedger's local admin.
 *
 * We chose (a). The deciding argument is ADR 0004 / task B5: every node and
 * every edge gets an `owner` column, and the local admin owns items just as a
 * member does. Under (b) `owner` would have to reference two disjoint identity
 * spaces — a Postgres foreign key cannot do that, so B5 would need either an
 * un-foreign-keyed `owner` (no referential integrity on the column the whole
 * access-control model rests on) or a polymorphic `(owner_kind, owner_id)`
 * pair threaded through every query and every join in ADR 0004 §3's traversal
 * rules. Under (a) it is one column, `references(users.id)`, and it covers
 * both. `c.get('principal').userId` is likewise already a `users.id`
 * everywhere in the codebase and stays one.
 *
 * The costs of (a) were weighed, not waved away:
 *
 *  - **Local login must be impossible.** `password_hash` is set to
 *    {@link UNUSABLE_PASSWORD_HASH}, which is not an argon2 encoded hash at
 *    all. Core's `verifyPassword` returns false for it for EVERY input — this
 *    is structural, not a low-probability guess: there is no plaintext that
 *    argon2 could verify against a non-argon2 string. We deliberately do NOT
 *    route this through core's `createUser`, which would hash some random
 *    password and leave an account that is merely hard to log into.
 *  - **A synthesised unique email/handle can collide or leak.** Both are
 *    derived from the `sub` alone — an opaque uuid Heorth already published to
 *    this service — so they carry no personal data to leak, and they are
 *    unique exactly because the `sub` is. The domain is `.invalid`, reserved
 *    by RFC 2606 and guaranteed never to resolve, so the address is
 *    non-routable by construction rather than by convention. The handle is
 *    namespaced with {@link HEORTH_HANDLE_PREFIX} so it cannot collide with a
 *    local handle (`admin`).
 *  - **Heorth must not be able to claim a local account.** Provenance is
 *    recorded in `household_members`; a `users` row with no row there is a
 *    local account and provisioning REFUSES it rather than adopting it.
 *
 * ── ROLE ─────────────────────────────────────────────────────────────────────
 *
 * The role travels from the token and is never elevated (ADR 0009). The stored
 * `users.role` is a mirror of the last token seen, kept in step so nothing
 * downstream reads a stale value; the authoritative role for any given request
 * is always the one in that request's token. A role the local enum does not
 * know is refused outright — mapping it to a default would be this service
 * inventing an authorization decision Heorth did not make.
 */

/** RFC 2606 reserved TLD: guaranteed never to resolve, so mail cannot be sent. */
export const HEORTH_EMAIL_DOMAIN = 'heorth.invalid';

/** Namespaces synthesised handles away from local ones (`admin`). */
export const HEORTH_HANDLE_PREFIX = 'heorth-';

/**
 * Not an argon2 encoded hash, so `verifyPassword` returns false for every
 * input. A Heorth-authored member has no local password and cannot obtain one.
 */
export const UNUSABLE_PASSWORD_HASH = '!heorth-authored:no-local-password';

/** Heorth's `sub` becomes the local `users.id`, so it has to be a uuid. */
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** The `role` claim, if it is one this deployment knows. */
export function asHouseholdRole(claim: unknown): Role | null {
  return typeof claim === 'string' && (userRole.enumValues as readonly string[]).includes(claim)
    ? (claim as Role)
    : null;
}

/** Synthesised, non-routable address for a Heorth-authored member. */
export function memberEmail(sub: string): string {
  return `${sub}@${HEORTH_EMAIL_DOMAIN}`;
}

/** Synthesised, namespaced handle for a Heorth-authored member. */
export function memberHandle(sub: string): string {
  return `${HEORTH_HANDLE_PREFIX}${sub}`;
}

/** True when this local user id was authored by Heorth rather than locally. */
export async function isHouseholdMember(userId: string): Promise<boolean> {
  if (!UUID_RE.test(userId)) return false;
  const [row] = await db
    .select({ userId: householdMembers.userId })
    .from(householdMembers)
    .where(eq(householdMembers.userId, userId))
    .limit(1);
  return !!row;
}

/**
 * Ensure a local record exists for the Heorth member `sub`, creating it on
 * first sight. Returns the local user id (which equals `sub`), or `null` to
 * deny the request — an unusable `sub`, or a `users` row that is not Heorth's
 * to claim.
 *
 * Idempotent and race-safe: concurrent first requests for the same `sub` both
 * take the `ON CONFLICT DO NOTHING` path, exactly one row is created, and both
 * return it.
 */
export async function provisionMember(sub: string, role: Role): Promise<string | null> {
  if (!UUID_RE.test(sub)) {
    logEvent({ event: 'satellite.member.rejected', success: false, reason: 'sub_not_a_uuid' });
    return null;
  }

  const [existing] = await db
    .select({ id: users.id, role: users.role })
    .from(users)
    .where(eq(users.id, sub))
    .limit(1);

  if (existing) {
    if (!(await isHouseholdMember(sub))) {
      // A local account already owns this id. Heorth does not get to take it
      // over — that would turn an identity assertion into an account takeover.
      logEvent({
        event: 'satellite.member.rejected',
        user_id: sub,
        success: false,
        reason: 'local_account',
      });
      return null;
    }
    if (existing.role !== role) {
      // Keep the mirror in step with the token; the token stays authoritative.
      await db.update(users).set({ role, updatedAt: new Date() }).where(eq(users.id, sub));
      logEvent({ event: 'satellite.member.role_changed', user_id: sub, role });
    }
    return existing.id;
  }

  // Bare DO NOTHING (no conflict target) so a concurrent insert conflicting on
  // the id, the email or the handle all resolve the same way: the other
  // request won, and the row it created is the one we go on to read.
  const created = await db
    .insert(users)
    .values({
      id: sub,
      email: memberEmail(sub),
      handle: memberHandle(sub),
      passwordHash: UNUSABLE_PASSWORD_HASH,
      role,
      displayName: null,
    })
    .onConflictDoNothing()
    .returning({ id: users.id });

  await db.insert(householdMembers).values({ userId: sub }).onConflictDoNothing();

  const [row] = await db.select({ id: users.id }).from(users).where(eq(users.id, sub)).limit(1);
  if (!row) return null;

  if (created.length > 0) {
    logEvent({ event: 'satellite.member.provisioned', user_id: sub, role, success: true });
  }
  return row.id;
}
