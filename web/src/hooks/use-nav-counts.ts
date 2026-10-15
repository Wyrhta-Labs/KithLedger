import { useQuery } from '@tanstack/react-query';
import { endOfDay } from 'date-fns';
import { QUERY_KEYS } from '../lib/constants';
import { listReminders, type ListRemindersParams } from '../api/reminders';

export type NavCountKey = 'reminders';
export type NavCounts = Partial<Record<NavCountKey, number | undefined>>;

/**
 * Counts for the sidebar badges. Reminders: pending ones due by the end of
 * today (overdue included). The key sits under QUERY_KEYS.reminders, so every
 * reminder mutation's invalidation refreshes the badge too. A failed request
 * leaves the count undefined — no badge, no toast; a 401 still logs out
 * through the API client.
 */
export function useNavCounts(): NavCounts {
  const params: ListRemindersParams = {
    status: 'pending',
    due_before: endOfDay(new Date()).toISOString(),
    limit: 1,
  };
  const reminders = useQuery({
    queryKey: [...QUERY_KEYS.reminders, 'nav-count', params],
    queryFn: () => listReminders(params),
    staleTime: 5 * 60_000,
    retry: false,
  });
  return { reminders: reminders.data?.meta.total };
}
