import { Hono } from 'hono';
import { ok, err } from '@wyrhta/core/http';
import { requireJwt, requireLocalAccount } from '../identity.js';
import { validationError } from '../lib/validation.js';
import { offboardMemberSchema } from '../validators/offboarding.js';
import {
  INVALID_SUCCESSOR,
  MEMBER_NOT_FOUND,
  NOT_A_HOUSEHOLD_MEMBER,
  SUCCESSOR_REQUIRED,
  offboardMember,
  previewOffboarding,
} from '../services/offboarding.js';

export const offboardingRouter = new Hono();

/**
 * ADR 0004 §4's reassign-on-offboarding, exposed (task B9).
 *
 * ── WHO MAY INVOKE THIS, AND WHY THAT CREDENTIAL ─────────────────────────────
 *
 * `requireJwt` + `requireLocalAccount` — the identical gate `/auth/keys` uses,
 * and for the identical reason: it is the only gate under which NONE of
 * ADR 0004 §2's three `kl_` credentials can get through, and no household
 * member can either.
 *
 *  - **member key / member token — no.** This destroys or transfers another
 *    member's entire dataset. A household member holding that over another is
 *    not a model this ADR describes anywhere, and a stolen member token must
 *    not be able to wipe the household. `requireJwt` verifies against the
 *    LOCAL HS256 secret, and a Heorth member token is asymmetric (ADR 0009),
 *    so a member cannot reach this even before `requireLocalAccount` refuses
 *    them by provenance.
 *  - **household dashboard key — no.** It is read-only by construction; this
 *    is the most destructive write in the service.
 *  - **ops key — no**, and this is the interesting one, because "offboarding"
 *    sounds like provisioning and ADR 0004 §2.3 gives the ops key
 *    "provisioning, migrations, schema, health". But an ops key is a
 *    long-lived secret that sits in a config file and a CI variable; letting
 *    it delete a member's whole dataset makes a leaked deploy credential a
 *    data-destruction credential. §2.3's ops key is also defined by having NO
 *    DATA PATH, and `requireDataAccess` refuses it at every domain router —
 *    admitting it here alone would carve the one exception into the rule that
 *    has no exceptions.
 *  - **local account JWT — yes.** It is short-lived and password-derived, so
 *    invoking this requires the admin password *now*, at the moment of
 *    removal, which is exactly the "explicit, one-time, decided at that
 *    moment" property §4 asks for. It is also the account this deployment is
 *    already operated through, and it is a human at a keyboard rather than a
 *    stored secret.
 *
 * Note what is NOT the gate: `role === 'admin'`. Roles are never consulted in
 * this codebase's access-control path (§4, no standing god-mode), and this
 * route is not an exception — it is the credential's provenance that decides.
 *
 * And note what this router does NOT mount: `requireDataAccess`. That guard
 * maps a credential to a data scope, and this flow has no scope, reads no
 * items and returns none. Reaching for it here would suggest the two things
 * are the same kind of operation, and the whole point is that they are not.
 */
offboardingRouter.use('*', requireJwt, requireLocalAccount);

function actorId(c: { get: (k: 'principal') => { userId: string } | undefined }): string {
  const principal = c.get('principal');
  // Unreachable: `requireJwt` sets the principal or returns 401 itself.
  if (!principal) throw new Error('No principal on an authenticated route');
  return principal.userId;
}

/** Map the service's refusals onto responses. None of them describe an item. */
function offboardingError(c: Parameters<typeof err>[0], e: unknown): Response | null {
  if (!(e instanceof Error)) return null;
  switch (e.message) {
    case MEMBER_NOT_FOUND:
      return err(c, 'NOT_FOUND', 'No such member', 404);
    case NOT_A_HOUSEHOLD_MEMBER:
      return err(
        c,
        'CONFLICT',
        'Only Heorth-authored household members are offboarded here',
        409,
      );
    case SUCCESSOR_REQUIRED:
      return err(
        c,
        'CONFLICT',
        'This member still owns items that must be inherited — name a successorId',
        409,
      );
    case INVALID_SUCCESSOR:
      return err(
        c,
        'VALIDATION_ERROR',
        'successorId must be a different, current household member',
        400,
      );
    default:
      return null;
  }
}

/**
 * Is this step needed for this member? One boolean and the member id — see
 * `src/services/offboarding.ts` for why nothing more is exposed, and why this
 * particular bit discloses nothing the `owner_id` RESTRICT does not.
 */
offboardingRouter.get('/:id/offboarding', async (c) => {
  try {
    return ok(c, await previewOffboarding(c.req.param('id')));
  } catch (e: unknown) {
    const res = offboardingError(c, e);
    if (res) return res;
    throw e;
  }
});

/** The decision itself, made once, at the moment of removal. */
offboardingRouter.post('/:id/offboarding', async (c) => {
  const body = offboardMemberSchema.safeParse(await c.req.json());
  if (!body.success) return validationError(c, body.error);

  try {
    const result = await offboardMember({
      actorId: actorId(c),
      memberId: c.req.param('id'),
      ownerOnlyItems: body.data.ownerOnlyItems,
      successorId: body.data.successorId,
    });
    return ok(c, result);
  } catch (e: unknown) {
    const res = offboardingError(c, e);
    if (res) return res;
    throw e;
  }
});
