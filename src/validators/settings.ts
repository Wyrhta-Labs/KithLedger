import { z } from 'zod';
import { SETTING_CATEGORIES } from '../services/setting-values.js';

export const createSettingValueSchema = z.object({
  category: z.enum(SETTING_CATEGORIES),
  value: z.string().trim().min(1).max(64),
  label: z.string().trim().min(1).max(64),
  isActive: z.boolean().optional(),
  sortOrder: z.coerce.number().int().min(0).optional(),
});

export const updateSettingValueSchema = z.object({
  value: z.string().trim().min(1).max(64).optional(),
  label: z.string().trim().min(1).max(64).optional(),
  isActive: z.boolean().optional(),
  sortOrder: z.coerce.number().int().min(0).optional(),
});

export type CreateSettingValueInput = z.infer<typeof createSettingValueSchema>;
export type UpdateSettingValueInput = z.infer<typeof updateSettingValueSchema>;
