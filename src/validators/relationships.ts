import { z } from 'zod';
import { visibilityFields } from './visibility.js';

const RELATIONSHIP_TYPES = ['friend', 'family', 'colleague', 'acquaintance', 'other'] as const;

export const createRelationshipSchema = z.object({
  fromPersonId: z.string().uuid(),
  toPersonId: z.string().uuid(),
  type: z.enum(RELATIONSHIP_TYPES),
  label: z.string().optional().nullable(),
  isMutual: z.boolean().optional().default(true),
  notes: z.string().optional().nullable(),
  ...visibilityFields,
}).refine((data) => data.fromPersonId !== data.toPersonId, {
  message: 'fromPersonId and toPersonId must be different',
  path: ['toPersonId'],
});

export const updateRelationshipSchema = z.object({
  type: z.enum(RELATIONSHIP_TYPES).optional(),
  label: z.string().optional().nullable(),
  isMutual: z.boolean().optional(),
  notes: z.string().optional().nullable(),
  ...visibilityFields,
});

export const listRelationshipsQuerySchema = z.object({
  person_id: z.string().uuid().optional(),
  type: z.enum(RELATIONSHIP_TYPES).optional(),
  limit: z.coerce.number().int().positive().max(100).optional(),
  offset: z.coerce.number().int().min(0).optional(),
});

export const graphQuerySchema = z.object({
  depth: z.coerce.number().int().min(1).max(3).optional().default(1),
});

export type CreateRelationshipInput = z.infer<typeof createRelationshipSchema>;
export type UpdateRelationshipInput = z.infer<typeof updateRelationshipSchema>;
export type ListRelationshipsQuery = z.infer<typeof listRelationshipsQuerySchema>;
export type GraphQuery = z.infer<typeof graphQuerySchema>;
