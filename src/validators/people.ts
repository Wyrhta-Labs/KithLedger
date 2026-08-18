import { z } from 'zod';
import { visibilityFields } from './visibility.js';

export const createPersonSchema = z.object({
  name: z.string().min(1),
  email: z.string().email().max(254).optional().nullable(),
  phone: z.string().optional().nullable(),
  birthday: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/)
    .refine(
      (val) => {
        const date = new Date(val + 'T00:00:00Z');
        return !isNaN(date.getTime()) && date <= new Date();
      },
      { message: 'Birthday must be a valid date and not in the future' }
    )
    .optional()
    .nullable(),
  tags: z.array(z.string()).optional().default([]),
  notes: z.string().optional().nullable(),
  avatarUrl: z
    .string()
    .url()
    .refine(
      (val) => {
        try {
          const { protocol } = new URL(val);
          return protocol === 'http:' || protocol === 'https:';
        } catch {
          return false;
        }
      },
      { message: 'Avatar URL must use http or https protocol' }
    )
    .optional()
    .nullable(),
  ...visibilityFields,
});

export const updatePersonSchema = createPersonSchema.partial();

export const listPeopleQuerySchema = z.object({
  q: z.string().optional(),
  tags: z.string().optional(), // comma-separated
  birthday_month: z.coerce.number().int().min(1).max(12).optional(),
  sort: z.enum(['name', 'created_at', 'updated_at', 'birthday']).optional().default('name'),
  order: z.enum(['asc', 'desc']).optional().default('asc'),
  limit: z.coerce.number().int().positive().max(100).optional(),
  offset: z.coerce.number().int().min(0).optional(),
});

export type CreatePersonInput = z.infer<typeof createPersonSchema>;
export type UpdatePersonInput = z.infer<typeof updatePersonSchema>;
export type ListPeopleQuery = z.infer<typeof listPeopleQuerySchema>;
