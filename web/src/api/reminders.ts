import { apiGet, apiPost, apiPatch, apiDelete } from './client';
import type { ListResponse, SingleResponse, Reminder } from '../lib/types';

export interface ListRemindersParams {
  person_id?: string;
  status?: string;
  /** Comma-separated statuses; takes precedence over `status`. */
  statuses?: string;
  kind?: 'generic' | 'birthday';
  from?: string;
  to?: string;
  limit?: number;
  offset?: number;
}

export interface CreateReminderInput {
  // Required: reminders.person_id is NOT NULL and the server demands a UUID.
  personId: string;
  dueAt: string;
  title: string;
  notes?: string | null;
  recurrence?: string | null;
  /** Marks a generated birthday reminder. Not changeable afterwards. */
  kind?: 'generic' | 'birthday';
  /** Days before the birthday; only meaningful with kind: 'birthday'. */
  leadDays?: number | null;
}

// No `status`: the server's updateReminderSchema derives from the create schema,
// which has no status field, so it was never accepted. Status changes go through
// the complete/snooze/dismiss endpoints.
export interface UpdateReminderInput {
  dueAt?: string;
  title?: string;
  notes?: string | null;
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
