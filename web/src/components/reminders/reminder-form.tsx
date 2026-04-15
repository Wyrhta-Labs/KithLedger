import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select } from '@/components/ui/select';
import { Textarea } from '@/components/ui/textarea';
import { useToast } from '@/components/ui/toast';
import { RECURRENCE_OPTIONS } from '@/lib/constants';
import type { Reminder } from '@/lib/types';

const schema = z.object({
  personId: z.string().optional(),
  dueAt: z.string().min(1, 'Due date is required'),
  title: z.string().min(1, 'Title is required'),
  notes: z.string().optional(),
  recurrence: z.string().optional(),
});

type FormValues = z.infer<typeof schema>;

interface ReminderFormProps {
  reminder?: Reminder;
  defaultPersonId?: string;
  personOptions?: Array<{ id: string; name: string }>;
  onSubmit: (data: FormValues) => Promise<void>;
  onCancel: () => void;
  isLoading?: boolean;
}

function toLocalDateTimeInputValue(value: string) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '';
  return new Date(date.getTime() - date.getTimezoneOffset() * 60_000).toISOString().slice(0, 16);
}

function fromLocalDateTimeInputValue(value: string) {
  return new Date(value).toISOString();
}

export default function ReminderForm({
  reminder,
  defaultPersonId,
  personOptions,
  onSubmit,
  onCancel,
  isLoading,
}: ReminderFormProps) {
  const { toast } = useToast();
  const { register, handleSubmit, formState: { errors } } = useForm<FormValues>({
    resolver: zodResolver(schema),
    defaultValues: {
      personId: reminder?.personId ?? defaultPersonId ?? '',
      dueAt: reminder?.dueAt ? toLocalDateTimeInputValue(reminder.dueAt) : '',
      title: reminder?.title ?? '',
      notes: reminder?.notes ?? '',
      recurrence: reminder?.recurrence ?? '',
    },
  });

  const handleFormSubmit = async (values: FormValues) => {
    try {
      const cleaned = {
        ...values,
        dueAt: fromLocalDateTimeInputValue(values.dueAt),
        personId: values.personId || undefined,
        notes: values.notes || undefined,
        recurrence: values.recurrence || undefined,
      };
      await onSubmit(cleaned);
    } catch (e) {
      toast((e as Error).message ?? 'Failed to save reminder', 'error');
    }
  };

  return (
    <form onSubmit={handleSubmit(handleFormSubmit)} className="space-y-4">
      {personOptions && (
        <div className="space-y-1">
          <Label htmlFor="personId">Person (optional)</Label>
          <Select id="personId" {...register('personId')}>
            <option value="">No person</option>
            {personOptions.map((p) => (
              <option key={p.id} value={p.id}>{p.name}</option>
            ))}
          </Select>
        </div>
      )}
      <div className="space-y-1">
        <Label htmlFor="title">Title *</Label>
        <Input id="title" {...register('title')} placeholder="Call mom, Send birthday card…" />
        {errors.title && <p className="text-xs text-red-600">{errors.title.message}</p>}
      </div>
      <div className="grid grid-cols-2 gap-4">
        <div className="space-y-1">
          <Label htmlFor="dueAt">Due Date *</Label>
          <Input id="dueAt" type="datetime-local" {...register('dueAt')} />
          {errors.dueAt && <p className="text-xs text-red-600">{errors.dueAt.message}</p>}
        </div>
        <div className="space-y-1">
          <Label htmlFor="recurrence">Recurrence</Label>
          <Select id="recurrence" {...register('recurrence')}>
            <option value="">One-time</option>
            {RECURRENCE_OPTIONS.map((r) => (
              <option key={r.value} value={r.value}>{r.label}</option>
            ))}
          </Select>
        </div>
      </div>
      <div className="space-y-1">
        <Label htmlFor="notes">Notes</Label>
        <Textarea id="notes" {...register('notes')} placeholder="Any additional context…" rows={3} />
      </div>
      <div className="flex justify-end gap-2 pt-2">
        <Button type="button" variant="outline" onClick={onCancel}>Cancel</Button>
        <Button type="submit" disabled={isLoading}>
          {isLoading ? 'Saving…' : reminder ? 'Update' : 'Set Reminder'}
        </Button>
      </div>
    </form>
  );
}
