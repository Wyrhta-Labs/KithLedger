import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { QUERY_KEYS } from '@/lib/constants';
import * as api from '@/api/settings';
import type { CreateSettingValueInput, UpdateSettingValueInput } from '@/api/settings';

export function useSettingValues() {
  return useQuery({
    queryKey: QUERY_KEYS.settingValues,
    queryFn: () => api.listSettingValues(),
  });
}

export function useCreateSettingValue() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: CreateSettingValueInput) => api.createSettingValue(input),
    onSuccess: () => qc.invalidateQueries({ queryKey: QUERY_KEYS.settingValues }),
  });
}

export function useUpdateSettingValue() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, input }: { id: string; input: UpdateSettingValueInput }) => api.updateSettingValue(id, input),
    onSuccess: () => qc.invalidateQueries({ queryKey: QUERY_KEYS.settingValues }),
  });
}

export function useDeleteSettingValue() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => api.deleteSettingValue(id),
    onSuccess: () => qc.invalidateQueries({ queryKey: QUERY_KEYS.settingValues }),
  });
}
