import { z } from 'zod';
import { OWNER_ONLY_DISPOSITIONS } from '../services/offboarding.js';

/**
 * ADR 0004 §4's offboarding decision, as an input shape (task B9).
 *
 * `ownerOnlyItems` has **no default**, on purpose. The ADR calls for an
 * "explicit, one-time ... step decided *at that moment*", and a default is the
 * opposite of an explicit decision: whichever value we picked would be the one
 * an operator got by not thinking about it, and both possible mistakes are
 * unrecoverable in different directions (`delete` destroys data nobody can
 * restore, `reassign` hands somebody's private notes to another member).
 * Omitting the field is a 400.
 */
export const offboardMemberSchema = z.object({
  ownerOnlyItems: z.enum(OWNER_ONLY_DISPOSITIONS),
  /**
   * Who inherits what is not deleted. Optional here and required by the
   * SERVICE only when something actually needs an owner — the service is where
   * that is knowable, and it is the layer that also enforces which successors
   * are acceptable for which items.
   */
  successorId: z.string().uuid().optional(),
});

export type OffboardMemberBody = z.infer<typeof offboardMemberSchema>;
