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
import { toApiDateTime, toDateTimeInputValue } from '@/lib/format';
import type { Reminder } from '@/lib/types';

// `personId` is required: the server's createReminderSchema wants a UUID and
// reminders.person_id is NOT NULL, so an unset person always 400s.
const schema = z.object({
  personId: z.string().min(1, 'Person is required'),
  dueAt: z.string().min(1, 'Due date is required'),
  title: z.string().min(1, 'Title is required'),
  notes: z.string().optional(),
  recurrence: z.string().optional(),
});

type FormValues = z.infer<typeof schema>;

/**
 * Wire shape. Blank nullable fields go out as `null`, not `undefined`:
 * `updateReminder` treats `undefined` as "leave unchanged", so omitting them
 * makes clearing notes or recurrence on an existing reminder silently fail.
 */
export type ReminderFormValues = {
  personId: string;
  dueAt: string;
  title: string;
  notes: string | null;
  recurrence: string | null;
};

interface ReminderFormProps {
  reminder?: Reminder;
  defaultPersonId?: string;
  personOptions?: Array<{ id: string; name: string }>;
  onSubmit: (data: ReminderFormValues) => Promise<void>;
  onCancel: () => void;
  isLoading?: boolean;
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
      dueAt: toDateTimeInputValue(reminder?.dueAt),
      title: reminder?.title ?? '',
      notes: reminder?.notes ?? '',
      recurrence: reminder?.recurrence ?? '',
    },
  });

  const handleFormSubmit = async (values: FormValues) => {
    try {
      const cleaned: ReminderFormValues = {
        personId: values.personId,
        dueAt: toApiDateTime(values.dueAt),
        title: values.title.trim(),
        notes: values.notes?.trim() ? values.notes.trim() : null,
        recurrence: values.recurrence || null,
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
