import { apiDelete, apiGet, apiPatch, apiPost } from './client';
import type { ListResponse, SettingValue, SingleResponse } from '../lib/types';

export interface CreateSettingValueInput {
  category: SettingValue['category'];
  value: string;
  label: string;
  isActive?: boolean;
  sortOrder?: number;
}

export interface UpdateSettingValueInput {
  value?: string;
  label?: string;
  isActive?: boolean;
  sortOrder?: number;
}

export function listSettingValues(): Promise<ListResponse<SettingValue>> {
  return apiGet('/settings/values');
}

export function createSettingValue(input: CreateSettingValueInput): Promise<SingleResponse<SettingValue>> {
  return apiPost('/settings/values', input);
}

export function updateSettingValue(id: string, input: UpdateSettingValueInput): Promise<SingleResponse<SettingValue>> {
  return apiPatch(`/settings/values/${id}`, input);
}

export function deleteSettingValue(id: string): Promise<SingleResponse<{ id: string }>> {
  return apiDelete(`/settings/values/${id}`);
}
