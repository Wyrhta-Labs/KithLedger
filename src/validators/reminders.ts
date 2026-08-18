import { z } from 'zod';
import { visibilityFields } from './visibility.js';

const REMINDER_STATUSES = ['pending', 'done', 'snoozed', 'dismissed'] as const;

const REMINDER_KINDS = ['generic', 'birthday'] as const;

export const createReminderSchema = z.object({
  personId: z.string().uuid(),
  dueAt: z.string().datetime(),
  title: z.string().min(1),
  notes: z.string().optional().nullable(),
  recurrence: z.string().optional().nullable(), // ISO 8601 duration
  kind: z.enum(REMINDER_KINDS).optional().default('generic'),
  /** Days before the birthday; only meaningful when kind='birthday'. */
  leadDays: z.number().int().min(0).max(365).optional().nullable(),
  ...visibilityFields,
});

/**
 * `kind` is deliberately omitted: it classifies how a reminder was created and
 * carries invariants (a birthday reminder is expected to have leadDays and a
 * person with a birthday). Leaving it in would make PATCH *accept* it while
 * `updateReminder`'s explicit field list silently ignored it, which is worse
 * than rejecting it outright.
 */
export const updateReminderSchema = createReminderSchema
  .omit({ personId: true, kind: true })
  .partial()
  // Strict so an omitted field is a 400 naming it, not a silent no-op. Zod
  // strips unknown keys by default, which would make `PATCH {"kind":"birthday"}`
  // return 200 while changing nothing. Status transitions have dedicated
  // endpoints (complete/snooze/dismiss) and are intentionally not PATCHable.
  .strict();

export const listRemindersQuerySchema = z.object({
  person_id: z.string().uuid().optional(),
  status: z.enum(REMINDER_STATUSES).optional(),
  kind: z.enum(REMINDER_KINDS).optional(),
  /**
   * Comma-separated statuses, for callers that need more than one (the birthday
   * widget needs pending + snoozed to mean "actively tracked"). Takes precedence
   * over `status` when both are supplied.
   */
  statuses: z
    .string()
    .optional()
    .transform((v) => (v ? v.split(',').map((s) => s.trim()).filter(Boolean) : undefined))
    .refine((v) => !v || v.every((s) => (REMINDER_STATUSES as readonly string[]).includes(s)), {
      message: `statuses must be a comma-separated subset of: ${REMINDER_STATUSES.join(', ')}`,
    }),
  due_before: z.string().datetime().optional(),
  overdue: z.enum(['true', 'false']).optional(),
  limit: z.coerce.number().int().positive().max(100).optional(),
  offset: z.coerce.number().int().min(0).optional(),
});

export const snoozeReminderSchema = z.object({
  snooze_until: z.string().datetime(),
});

export type CreateReminderInput = z.infer<typeof createReminderSchema>;
export type UpdateReminderInput = z.infer<typeof updateReminderSchema>;
export type ListRemindersQuery = z.infer<typeof listRemindersQuerySchema>;
export type SnoozeReminderInput = z.infer<typeof snoozeReminderSchema>;
