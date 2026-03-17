import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { QUERY_KEYS } from '../lib/constants';
import * as api from '../api/relationships';
import type { ListRelationshipsParams, CreateRelationshipInput, UpdateRelationshipInput } from '../api/relationships';

export function useRelationships(params: ListRelationshipsParams = {}) {
  return useQuery({
    queryKey: [...QUERY_KEYS.relationships, params],
    queryFn: () => api.listRelationships(params),
  });
}

export function useRelationship(id: string) {
  return useQuery({
    queryKey: QUERY_KEYS.relationship(id),
    queryFn: () => api.getRelationship(id),
    enabled: !!id,
  });
}

export function useCreateRelationship() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: CreateRelationshipInput) => api.createRelationship(input),
    onSuccess: () => qc.invalidateQueries({ queryKey: QUERY_KEYS.relationships }),
  });
}

export function useUpdateRelationship(id: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: UpdateRelationshipInput) => api.updateRelationship(id, input),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: QUERY_KEYS.relationships });
      qc.invalidateQueries({ queryKey: QUERY_KEYS.relationship(id) });
    },
  });
}

export function useDeleteRelationship() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => api.deleteRelationship(id),
    onSuccess: () => qc.invalidateQueries({ queryKey: QUERY_KEYS.relationships }),
  });
}
