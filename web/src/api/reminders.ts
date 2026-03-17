import { apiGet, apiPost, apiPatch, apiDelete } from './client';
import type { ListResponse, SingleResponse, Reminder } from '../lib/types';

export interface ListRemindersParams {
  person_id?: string;
  status?: string;
  from?: string;
  to?: string;
  limit?: number;
  offset?: number;
}

export interface CreateReminderInput {
  personId?: string;
  dueAt: string;
  title: string;
  notes?: string;
  recurrence?: string;
}

export interface UpdateReminderInput {
  dueAt?: string;
  title?: string;
  notes?: string | null;
  status?: 'pending' | 'done' | 'snoozed' | 'dismissed';
  recurrence?: string | null;
}

function toQueryString(params: object): string {
  const qs = new URLSearchParams();
  for (const [k, v] of Object.entries(params)) {
    if (v !== undefined && v !== null && v !== '') {
      qs.set(k, String(v));
    }
  }
  const s = qs.toString();
  return s ? `?${s}` : '';
}

export function listReminders(params: ListRemindersParams = {}): Promise<ListResponse<Reminder>> {
  return apiGet(`/reminders${toQueryString(params)}`);
}

export function getReminder(id: string): Promise<SingleResponse<Reminder>> {
  return apiGet(`/reminders/${id}`);
}

export function createReminder(input: CreateReminderInput): Promise<SingleResponse<Reminder>> {
  return apiPost('/reminders', input);
}

export function updateReminder(id: string, input: UpdateReminderInput): Promise<SingleResponse<Reminder>> {
  return apiPatch(`/reminders/${id}`, input);
}

export function deleteReminder(id: string): Promise<SingleResponse<{ id: string }>> {
  return apiDelete(`/reminders/${id}`);
}

export function completeReminder(id: string): Promise<SingleResponse<Reminder>> {
  return apiPost(`/reminders/${id}/complete`, {});
}

export function snoozeReminder(id: string, snoozeUntil: string): Promise<SingleResponse<Reminder>> {
  return apiPost(`/reminders/${id}/snooze`, { snooze_until: snoozeUntil });
}

export function dismissReminder(id: string): Promise<SingleResponse<Reminder>> {
  return apiPost(`/reminders/${id}/dismiss`, {});
}
