import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { QUERY_KEYS } from '../lib/constants';
import * as api from '../api/reminders';
import type { ListRemindersParams, CreateReminderInput, UpdateReminderInput } from '../api/reminders';

export function useReminders(params: ListRemindersParams = {}) {
  return useQuery({
    queryKey: [...QUERY_KEYS.reminders, params],
    queryFn: () => api.listReminders(params),
  });
}

export function useReminder(id: string) {
  return useQuery({
    queryKey: QUERY_KEYS.reminder(id),
    queryFn: () => api.getReminder(id),
    enabled: !!id,
  });
}

export function useCreateReminder() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: CreateReminderInput) => api.createReminder(input),
    onSuccess: () => qc.invalidateQueries({ queryKey: QUERY_KEYS.reminders }),
  });
}

export function useUpdateReminder(id: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: UpdateReminderInput) => api.updateReminder(id, input),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: QUERY_KEYS.reminders });
      qc.invalidateQueries({ queryKey: QUERY_KEYS.reminder(id) });
    },
  });
}

export function useDeleteReminder() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => api.deleteReminder(id),
    onSuccess: () => qc.invalidateQueries({ queryKey: QUERY_KEYS.reminders }),
  });
}

export function useCompleteReminder() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => api.completeReminder(id),
    onSuccess: () => qc.invalidateQueries({ queryKey: QUERY_KEYS.reminders }),
  });
}

export function useSnoozeReminder() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, snoozeUntil }: { id: string; snoozeUntil: string }) =>
      api.snoozeReminder(id, snoozeUntil),
    onSuccess: () => qc.invalidateQueries({ queryKey: QUERY_KEYS.reminders }),
  });
}

export function useDismissReminder() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => api.dismissReminder(id),
    onSuccess: () => qc.invalidateQueries({ queryKey: QUERY_KEYS.reminders }),
  });
}
