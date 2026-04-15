import { useEffect } from 'react';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select } from '@/components/ui/select';
import { Textarea } from '@/components/ui/textarea';
import { useToast } from '@/components/ui/toast';
import { useSettingValues } from '@/hooks/use-setting-values';
import { getActiveSettingValues } from '@/lib/setting-values';
import type { Relationship } from '@/lib/types';

const schema = z.object({
  fromPersonId: z.string().min(1, 'From person is required'),
  toPersonId: z.string().min(1, 'To person is required'),
  type: z.string().min(1, 'Type is required'),
  label: z.string().optional(),
  isMutual: z.boolean().default(true),
  notes: z.string().optional(),
});

type FormValues = z.infer<typeof schema>;

interface RelationshipFormProps {
  relationship?: Relationship;
  defaultFromPersonId?: string;
  personOptions: Array<{ id: string; name: string }>;
  onSubmit: (data: FormValues) => Promise<void>;
  onCancel: () => void;
  isLoading?: boolean;
}

export default function RelationshipForm({
  relationship,
  defaultFromPersonId,
  personOptions,
  onSubmit,
  onCancel,
  isLoading,
}: RelationshipFormProps) {
  const { toast } = useToast();
  const { data: settingValuesData } = useSettingValues();
  const relationshipTypes = getActiveSettingValues(settingValuesData?.data ?? [], 'relationship.type');
  const { register, handleSubmit, setValue, getValues, formState: { errors } } = useForm<FormValues>({
    resolver: zodResolver(schema),
    defaultValues: {
      fromPersonId: relationship?.fromPersonId ?? defaultFromPersonId ?? '',
      toPersonId: relationship?.toPersonId ?? '',
      type: relationship?.type ?? relationshipTypes[0]?.value ?? '',
      label: relationship?.label ?? '',
      isMutual: relationship?.isMutual ?? true,
      notes: relationship?.notes ?? '',
    },
  });

  useEffect(() => {
    if (!relationship && !getValues('type') && relationshipTypes[0]?.value) {
      setValue('type', relationshipTypes[0].value, { shouldValidate: true });
    }
  }, [getValues, relationship, relationshipTypes, setValue]);

  const handleFormSubmit = async (values: FormValues) => {
    try {
      const cleaned = {
        ...values,
        label: values.label || undefined,
        notes: values.notes || undefined,
      };
      await onSubmit(cleaned);
    } catch (e) {
      toast((e as Error).message ?? 'Failed to save relationship', 'error');
    }
  };

  return (
    <form onSubmit={handleSubmit(handleFormSubmit)} className="space-y-4">
      <div className="grid grid-cols-2 gap-4">
        <div className="space-y-1">
          <Label htmlFor="fromPersonId">From Person *</Label>
          <Select id="fromPersonId" {...register('fromPersonId')}>
            <option value="">Select…</option>
            {personOptions.map((p) => (
              <option key={p.id} value={p.id}>{p.name}</option>
            ))}
          </Select>
          {errors.fromPersonId && <p className="text-xs text-red-600">{errors.fromPersonId.message}</p>}
        </div>
        <div className="space-y-1">
          <Label htmlFor="toPersonId">To Person *</Label>
          <Select id="toPersonId" {...register('toPersonId')}>
            <option value="">Select…</option>
            {personOptions.map((p) => (
              <option key={p.id} value={p.id}>{p.name}</option>
            ))}
          </Select>
          {errors.toPersonId && <p className="text-xs text-red-600">{errors.toPersonId.message}</p>}
        </div>
      </div>
      <div className="grid grid-cols-2 gap-4">
        <div className="space-y-1">
          <Label htmlFor="type">Type *</Label>
          <Select id="type" {...register('type')}>
            <option value="">Select a type…</option>
            {relationshipTypes.map((t) => (
              <option key={t.id} value={t.value}>{t.label}</option>
            ))}
          </Select>
          {errors.type && <p className="text-xs text-red-600">{errors.type.message}</p>}
        </div>
        <div className="space-y-1">
          <Label htmlFor="label">Label (optional)</Label>
          <Input id="label" {...register('label')} placeholder="Best friend, mentor…" />
        </div>
      </div>
      <div className="flex items-center gap-2">
        <input type="checkbox" id="isMutual" {...register('isMutual')} className="h-4 w-4 rounded border-gray-300" />
        <Label htmlFor="isMutual">Mutual relationship (bidirectional)</Label>
      </div>
      <div className="space-y-1">
        <Label htmlFor="notes">Notes</Label>
        <Textarea id="notes" {...register('notes')} placeholder="Context about this relationship…" rows={2} />
      </div>
      <div className="flex justify-end gap-2 pt-2">
        <Button type="button" variant="outline" onClick={onCancel}>Cancel</Button>
        <Button type="submit" disabled={isLoading}>
          {isLoading ? 'Saving…' : relationship ? 'Update' : 'Add Relationship'}
        </Button>
      </div>
    </form>
  );
}
