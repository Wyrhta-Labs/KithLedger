import { z } from 'zod';
import DOMPurify from 'isomorphic-dompurify';

function sanitizeHtml(val: string): string {
  return DOMPurify.sanitize(val, { ALLOWED_TAGS: [] });
}

export const createPersonSchema = z.object({
  name: z.string()
    .min(1)
    .max(255, 'Name cannot exceed 255 characters')
    .transform(sanitizeHtml),
  email: z.string().email().max(254).optional().nullable(),
  phone: z.string()
    .max(50, 'Phone cannot exceed 50 characters')
    .transform(val => val ? sanitizeHtml(val) : val)
    .optional()
    .nullable(),
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
  tags: z.array(
    z.string()
      .max(100, 'Tag cannot exceed 100 characters')
      .transform(sanitizeHtml)
  ).optional().default([]),
  notes: z.string()
    .max(10000, 'Notes cannot exceed 10,000 characters')
    .transform(sanitizeHtml)
    .optional()
    .nullable(),
  avatarUrl: z
    .string()
    .url()
    .max(2048, 'URL too long')
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
});

export const updatePersonSchema = createPersonSchema.partial();

export const listPeopleQuerySchema = z.object({
  q: z.string()
    .max(200, 'Search query too long')
    .transform(sanitizeHtml)
    .optional(),
  tags: z.string()
    .max(500, 'Tags parameter too long')
    .optional(),
  birthday_month: z.coerce.number().int().min(1).max(12).optional(),
  sort: z.enum(['name', 'created_at', 'updated_at', 'birthday']).optional().default('name'),
  order: z.enum(['asc', 'desc']).optional().default('asc'),
  limit: z.coerce.number().int().positive().max(100).optional(),
  offset: z.coerce.number().int().min(0).optional(),
});

export type CreatePersonInput = z.infer<typeof createPersonSchema>;
export type UpdatePersonInput = z.infer<typeof updatePersonSchema>;
export type ListPeopleQuery = z.infer<typeof listPeopleQuerySchema>;
