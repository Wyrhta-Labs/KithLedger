import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select } from '@/components/ui/select';
import { Textarea } from '@/components/ui/textarea';
import { useToast } from '@/components/ui/toast';
import { INTERACTION_TYPES, SENTIMENT_OPTIONS, CHANNEL_OPTIONS } from '@/lib/constants';
import { toApiDateTime, toDateTimeInputValue } from '@/lib/format';
import type { Interaction } from '@/lib/types';

const schema = z.object({
  personId: z.string().min(1, 'Person is required'),
  occurredAt: z.string().min(1, 'Date is required'),
  type: z.enum(['meeting', 'call', 'message', 'email', 'other']),
  channel: z
    .enum(['in-person', 'phone', 'sms', 'email', 'video', 'social'])
    .optional()
    .or(z.literal('')),
  notes: z.string().optional(),
  sentiment: z.enum(['positive', 'neutral', 'negative']).optional().or(z.literal('')),
});

type FormValues = z.infer<typeof schema>;

/**
 * Blank nullable fields go out as `null`, not `undefined`: `updateInteraction`
 * treats `undefined` as "leave unchanged", so selecting "None" for channel or
 * sentiment on an existing interaction would silently fail to clear it.
 */
export interface CleanInteractionFormValues {
  personId: string;
  occurredAt: string;
  type: 'meeting' | 'call' | 'message' | 'email' | 'other';
  channel: 'in-person' | 'phone' | 'sms' | 'email' | 'video' | 'social' | null;
  notes: string | null;
  sentiment: 'positive' | 'neutral' | 'negative' | null;
}

interface InteractionFormProps {
  interaction?: Interaction;
  defaultPersonId?: string;
  personOptions?: Array<{ id: string; name: string }>;
  onSubmit: (data: CleanInteractionFormValues) => Promise<void>;
  onCancel: () => void;
  isLoading?: boolean;
}

export default function InteractionForm({
  interaction,
  defaultPersonId,
  personOptions,
  onSubmit,
  onCancel,
  isLoading,
}: InteractionFormProps) {
  const { toast } = useToast();
  const { register, handleSubmit, formState: { errors } } = useForm<FormValues>({
    resolver: zodResolver(schema),
    defaultValues: {
      personId: interaction?.personId ?? defaultPersonId ?? '',
      occurredAt: toDateTimeInputValue(interaction?.occurredAt ?? new Date().toISOString()),
      type: interaction?.type ?? 'meeting',
      channel: interaction?.channel ?? '',
      notes: interaction?.notes ?? '',
      sentiment: interaction?.sentiment ?? '',
    },
  });

  const handleFormSubmit = async (values: FormValues) => {
    try {
      const cleaned: CleanInteractionFormValues = {
        personId: values.personId,
        occurredAt: toApiDateTime(values.occurredAt),
        type: values.type,
        channel: values.channel || null,
        notes: values.notes?.trim() ? values.notes.trim() : null,
        sentiment: values.sentiment || null,
      };
      await onSubmit(cleaned);
    } catch (e) {
      toast((e as Error).message ?? 'Failed to save interaction', 'error');
    }
  };

  return (
    <form onSubmit={handleSubmit(handleFormSubmit)} className="space-y-4">
      {personOptions && (
        <div className="space-y-1">
          <Label htmlFor="personId">Person *</Label>
          <Select id="personId" {...register('personId')}>
            <option value="">Select a person…</option>
            {personOptions.map((p) => (
              <option key={p.id} value={p.id}>{p.name}</option>
            ))}
          </Select>
          {errors.personId && <p className="text-xs text-red-600">{errors.personId.message}</p>}
        </div>
      )}
      <div className="grid grid-cols-2 gap-4">
        <div className="space-y-1">
          <Label htmlFor="occurredAt">Date & Time *</Label>
          <Input id="occurredAt" type="datetime-local" {...register('occurredAt')} />
          {errors.occurredAt && <p className="text-xs text-red-600">{errors.occurredAt.message}</p>}
        </div>
        <div className="space-y-1">
          <Label htmlFor="type">Type *</Label>
          <Select id="type" {...register('type')}>
            {INTERACTION_TYPES.map((t) => (
              <option key={t.value} value={t.value}>{t.label}</option>
            ))}
          </Select>
        </div>
      </div>
      <div className="grid grid-cols-2 gap-4">
        <div className="space-y-1">
          <Label htmlFor="channel">Channel</Label>
          <Select id="channel" {...register('channel')}>
            <option value="">None</option>
            {CHANNEL_OPTIONS.map((ch) => (
              <option key={ch.value} value={ch.value}>{ch.label}</option>
            ))}
          </Select>
        </div>
        <div className="space-y-1">
          <Label htmlFor="sentiment">Sentiment</Label>
          <Select id="sentiment" {...register('sentiment')}>
            <option value="">None</option>
            {SENTIMENT_OPTIONS.map((s) => (
              <option key={s.value} value={s.value}>{s.label}</option>
            ))}
          </Select>
        </div>
      </div>
      <div className="space-y-1">
        <Label htmlFor="notes">Notes</Label>
        <Textarea id="notes" {...register('notes')} placeholder="What happened?" rows={3} />
      </div>
      <div className="flex justify-end gap-2 pt-2">
        <Button type="button" variant="outline" onClick={onCancel}>Cancel</Button>
        <Button type="submit" disabled={isLoading}>
          {isLoading ? 'Saving…' : interaction ? 'Update' : 'Log Interaction'}
        </Button>
      </div>
    </form>
  );
}
