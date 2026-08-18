import { eq } from 'drizzle-orm';
import type { Principal } from '@wyrhta/core/auth';
import { db } from '../db/index.js';
import { apiKeyCredentials, type CredentialKind } from '../db/schema/index.js';

export type { CredentialKind };
export { CREDENTIAL_KINDS, DEFAULT_CREDENTIAL_KIND } from '../db/schema/index.js';

/**
 * ADR 0004 §2 — "three principals, held as SEPARATE credentials (least
 * privilege)" (task B8).
 *
 * ── WHERE THE CALLER'S TYPE IS DECIDED, AND WHY THERE ────────────────────────
 *
 * It is decided ONCE, at authentication, from the credential itself — never
 * from the request. Nothing about the path, the method, a header or a query
 * parameter is consulted, because any of those would let a caller choose its
 * own principal type by asking differently, which is not an access-control
 * model at all. Concretely:
 *
 *  - a `kl_` API key is whichever kind its `api_key_credentials` row says.
 *    That row is written when the key is issued and can only be written by a
 *    JWT-authenticated local account (`/auth/keys` refuses API-key auth), so a
 *    key can never mint a key of any kind, let alone a wider one.
 *  - every JWT is a MEMBER principal, and that is structural rather than a
 *    default: the only two JWTs this service accepts are the local HS256 admin
 *    token (a local account = a member of the one-person household, B4) and a
 *    Heorth-issued member token (ADR 0009 fixes its claims to `sub` + `role`,
 *    so it cannot carry a principal-type claim, and KithLedger holds no key
 *    that could sign one anyway). There is no third JWT shape to confuse this
 *    with.
 *
 * The kind therefore travels ON the {@link Principal} that `requireAuth`
 * already puts on the context, and {@link credentialOf} is the single reader.
 */

/**
 * A {@link Principal} carrying which of ADR 0004 §2's three principals it is.
 *
 * `Principal` is `@wyrhta/core`'s type and is shared by every service on the
 * foundation, so B8's extra dimension is added structurally here rather than
 * by widening core: a `ScopedPrincipal` IS a `Principal`, so core's guards
 * carry it through untouched and nothing downstream needs to know.
 */
export interface ScopedPrincipal extends Principal {
  readonly credential: CredentialKind;
}

/**
 * Which of the three principals this caller is.
 *
 * A principal with no `credential` came from core's JWT path — see above for
 * why that is a member principal by construction and not a fallback. The
 * elevated kinds are unreachable this way: they exist only as a stored row
 * against a `kl_` key, and {@link credentialKindForKey} refuses a key without
 * one, so nothing can arrive here claiming `household` or `ops` that did not
 * present a key an operator deliberately issued as such.
 */
export function credentialOf(principal: Principal): CredentialKind {
  const kind = (principal as Partial<ScopedPrincipal>).credential;
  return kind ?? 'member';
}

/**
 * The kind recorded for an API key, or `null` when the key has no row.
 *
 * `null` means REFUSE, not "assume member" — see `src/db/schema/credentials.ts`
 * for why this fails closed.
 */
export async function credentialKindForKey(keyId: string): Promise<CredentialKind | null> {
  const [row] = await db
    .select({ kind: apiKeyCredentials.kind })
    .from(apiKeyCredentials)
    .where(eq(apiKeyCredentials.keyId, keyId))
    .limit(1);
  return row?.kind ?? null;
}

/** Record the kind of a freshly issued key. */
export async function recordCredentialKind(keyId: string, kind: CredentialKind): Promise<void> {
  await db.insert(apiKeyCredentials).values({ keyId, kind }).onConflictDoNothing();
}
