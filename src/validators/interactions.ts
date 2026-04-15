import { z } from 'zod';

const CHANNELS = ['in-person', 'phone', 'sms', 'email', 'video', 'social'] as const;
const SENTIMENTS = ['positive', 'neutral', 'negative'] as const;

export const createInteractionSchema = z.object({
  personId: z.string().uuid(),
  occurredAt: z.string().datetime(),
  type: z.string().trim().min(1),
  channel: z.enum(CHANNELS).optional().nullable(),
  notes: z.string().optional().nullable(),
  sentiment: z.enum(SENTIMENTS).optional().nullable(),
});

export const updateInteractionSchema = createInteractionSchema.partial().omit({ personId: true });

export const listInteractionsQuerySchema = z.object({
  person_id: z.string().uuid().optional(),
  type: z.string().trim().min(1).optional(),
  from: z.string().datetime().optional(),
  to: z.string().datetime().optional(),
  limit: z.coerce.number().int().positive().max(100).optional(),
  offset: z.coerce.number().int().min(0).optional(),
});

export type CreateInteractionInput = z.infer<typeof createInteractionSchema>;
export type UpdateInteractionInput = z.infer<typeof updateInteractionSchema>;
export type ListInteractionsQuery = z.infer<typeof listInteractionsQuerySchema>;
