import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { QUERY_KEYS } from '../lib/constants';
import * as api from '../api/people';
import * as remindersApi from '../api/reminders';
import { computeBirthdayReminderDueAt } from '../lib/birthday';
import type { ListPeopleParams, CreatePersonInput, UpdatePersonInput } from '../api/people';
import type { Person } from '../lib/types';

export function usePeople(params: ListPeopleParams = {}) {
  return useQuery({
    queryKey: [...QUERY_KEYS.people, params],
    queryFn: () => api.listPeople(params),
  });
}

export function usePerson(id: string) {
  return useQuery({
    queryKey: QUERY_KEYS.person(id),
    queryFn: () => api.getPerson(id),
    enabled: !!id,
  });
}

export function usePersonGraph(id: string, depth = 2) {
  return useQuery({
    queryKey: QUERY_KEYS.personGraph(id),
    queryFn: () => api.getPersonGraph(id, depth),
    enabled: !!id,
  });
}

export function useCreatePerson() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: CreatePersonInput) => api.createPerson(input),
    onSuccess: () => qc.invalidateQueries({ queryKey: QUERY_KEYS.people }),
  });
}

export interface CreatePersonWithBirthdayReminderInput extends CreatePersonInput {
  /** Days before the birthday; `null` to skip the reminder entirely. */
  birthdayReminderLeadDays: number | null;
}

export interface CreatePersonWithBirthdayReminderResult {
  person: Person;
  /** Set when the person was created but the reminder could not be. */
  reminderError: string | null;
}

/**
 * Creates a person and, optionally, a recurring reminder for their birthday.
 *
 * Two calls, because POST /reminders needs the new person's id. That makes it
 * non-atomic, so a reminder failure is reported without discarding the person:
 * the person is the primary intent, and deleting a just-created row to unwind a
 * failed secondary write would lose real user input.
 */
export function useCreatePersonWithBirthdayReminder() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({
      birthdayReminderLeadDays,
      ...personInput
    }: CreatePersonWithBirthdayReminderInput): Promise<CreatePersonWithBirthdayReminderResult> => {
      const { data: person } = await api.createPerson(personInput);

      if (birthdayReminderLeadDays === null || !person.birthday) {
        return { person, reminderError: null };
      }

      try {
        await remindersApi.createReminder({
          personId: person.id,
          dueAt: computeBirthdayReminderDueAt(person.birthday, birthdayReminderLeadDays),
          title: `Birthday: ${person.name}`,
          recurrence: 'P1Y',
          kind: 'birthday',
          leadDays: birthdayReminderLeadDays,
        });
        return { person, reminderError: null };
      } catch (e) {
        return { person, reminderError: (e as Error).message ?? 'Unknown error' };
      }
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: QUERY_KEYS.people });
      qc.invalidateQueries({ queryKey: QUERY_KEYS.reminders });
    },
  });
}

export function useUpdatePerson(id: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: UpdatePersonInput) => api.updatePerson(id, input),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: QUERY_KEYS.people });
      qc.invalidateQueries({ queryKey: QUERY_KEYS.person(id) });
    },
  });
}

export function useDeletePerson() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => api.deletePerson(id),
    onSuccess: () => qc.invalidateQueries({ queryKey: QUERY_KEYS.people }),
  });
}
