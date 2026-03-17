import { z } from 'zod';

const REMINDER_STATUSES = ['pending', 'done', 'snoozed', 'dismissed'] as const;

export const createReminderSchema = z.object({
  personId: z.string().uuid(),
  dueAt: z.string().datetime(),
  title: z.string().min(1),
  notes: z.string().optional().nullable(),
  recurrence: z.string().optional().nullable(), // ISO 8601 duration
});

export const updateReminderSchema = createReminderSchema.partial().omit({ personId: true });

export const listRemindersQuerySchema = z.object({
  person_id: z.string().uuid().optional(),
  status: z.enum(REMINDER_STATUSES).optional(),
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
