import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { QUERY_KEYS } from '../lib/constants';
import * as api from '../api/interactions';
import type { ListInteractionsParams, CreateInteractionInput, UpdateInteractionInput } from '../api/interactions';

export function useInteractions(params: ListInteractionsParams = {}) {
  return useQuery({
    queryKey: [...QUERY_KEYS.interactions, params],
    queryFn: () => api.listInteractions(params),
  });
}

export function useInteraction(id: string) {
  return useQuery({
    queryKey: QUERY_KEYS.interaction(id),
    queryFn: () => api.getInteraction(id),
    enabled: !!id,
  });
}

export function useCreateInteraction() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: CreateInteractionInput) => api.createInteraction(input),
    onSuccess: () => qc.invalidateQueries({ queryKey: QUERY_KEYS.interactions }),
  });
}

export function useUpdateInteraction(id: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: UpdateInteractionInput) => api.updateInteraction(id, input),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: QUERY_KEYS.interactions });
      qc.invalidateQueries({ queryKey: QUERY_KEYS.interaction(id) });
    },
  });
}

export function useDeleteInteraction() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => api.deleteInteraction(id),
    onSuccess: () => qc.invalidateQueries({ queryKey: QUERY_KEYS.interactions }),
  });
}
