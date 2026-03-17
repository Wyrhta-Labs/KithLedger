import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { QUERY_KEYS } from '../lib/constants';
import * as api from '../api/people';
import type { ListPeopleParams, CreatePersonInput, UpdatePersonInput } from '../api/people';

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
