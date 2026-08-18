import { z } from 'zod';
import { VISIBILITY_VALUES } from '../db/schema/visibility.js';

/**
 * The two governance fields ADR 0004 §1/§4 puts on every node and edge, as
 * request input.
 *
 * `sharedWith` is the WHOLE share set, not a delta: the owner declares who can
 * see the item, `[]` revokes everything, and there is no add/remove pair whose
 * interleaving could produce an audience nobody asked for. Both fields are
 * owner-only on update (§4, "sharing is not transitive") — enforced in the
 * service layer, since the writer's identity is a thing the database never
 * sees.
 *
 * Omitting `visibility` on create leaves it to the column default
 * (`household`, §4), so the default lives in exactly one place.
 */
export const visibilityFields = {
  visibility: z.enum(VISIBILITY_VALUES).optional(),
  sharedWith: z.array(z.string().uuid()).optional(),
};

export const visibilityInputSchema = z.object(visibilityFields);
export type VisibilityInput = z.infer<typeof visibilityInputSchema>;
