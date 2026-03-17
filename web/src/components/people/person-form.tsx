import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { useToast } from '@/components/ui/toast';
import type { Person } from '@/lib/types';

const schema = z.object({
  name: z.string().min(1, 'Name is required'),
  email: z.string().email('Invalid email').optional().or(z.literal('')),
  phone: z.string().optional(),
  birthday: z.string().optional(),
  tags: z.string().optional(), // comma-separated
  notes: z.string().optional(),
  avatarUrl: z.string().url('Invalid URL').optional().or(z.literal('')),
});

type FormValues = z.infer<typeof schema>;

export type PersonFormValues = Omit<FormValues, 'tags'> & { tags: string[] };

interface PersonFormProps {
  person?: Person;
  onSubmit: (data: PersonFormValues) => Promise<void>;
  onCancel: () => void;
  isLoading?: boolean;
}

export default function PersonForm({ person, onSubmit, onCancel, isLoading }: PersonFormProps) {
  const { toast } = useToast();
  const {
    register,
    handleSubmit,
    formState: { errors },
  } = useForm<FormValues>({
    resolver: zodResolver(schema),
    defaultValues: {
      name: person?.name ?? '',
      email: person?.email ?? '',
      phone: person?.phone ?? '',
      birthday: person?.birthday ?? '',
      tags: person?.tags?.join(', ') ?? '',
      notes: person?.notes ?? '',
      avatarUrl: person?.avatarUrl ?? '',
    },
  });

  const handleFormSubmit = async (values: FormValues) => {
    try {
      const tags = values.tags
        ? values.tags.split(',').map((t) => t.trim()).filter(Boolean)
        : [];
      const cleaned: PersonFormValues = { ...values, tags };
      await onSubmit(cleaned);
    } catch (e) {
      toast((e as Error).message ?? 'Failed to save person', 'error');
    }
  };

  return (
    <form onSubmit={handleSubmit(handleFormSubmit)} className="space-y-4">
      <div className="space-y-1">
        <Label htmlFor="name">Name *</Label>
        <Input id="name" {...register('name')} placeholder="Jane Doe" />
        {errors.name && <p className="text-xs text-red-600">{errors.name.message}</p>}
      </div>
      <div className="grid grid-cols-2 gap-4">
        <div className="space-y-1">
          <Label htmlFor="email">Email</Label>
          <Input id="email" type="email" {...register('email')} placeholder="jane@example.com" />
          {errors.email && <p className="text-xs text-red-600">{errors.email.message}</p>}
        </div>
        <div className="space-y-1">
          <Label htmlFor="phone">Phone</Label>
          <Input id="phone" {...register('phone')} placeholder="+1 555 0100" />
        </div>
      </div>
      <div className="grid grid-cols-2 gap-4">
        <div className="space-y-1">
          <Label htmlFor="birthday">Birthday</Label>
          <Input id="birthday" type="date" {...register('birthday')} />
        </div>
        <div className="space-y-1">
          <Label htmlFor="tags">Tags (comma-separated)</Label>
          <Input id="tags" {...register('tags')} placeholder="friend, coworker" />
        </div>
      </div>
      <div className="space-y-1">
        <Label htmlFor="avatarUrl">Avatar URL</Label>
        <Input id="avatarUrl" {...register('avatarUrl')} placeholder="https://..." />
        {errors.avatarUrl && <p className="text-xs text-red-600">{errors.avatarUrl.message}</p>}
      </div>
      <div className="space-y-1">
        <Label htmlFor="notes">Notes</Label>
        <Textarea id="notes" {...register('notes')} placeholder="Any notes..." rows={3} />
      </div>
      <div className="flex justify-end gap-2 pt-2">
        <Button type="button" variant="outline" onClick={onCancel}>
          Cancel
        </Button>
        <Button type="submit" disabled={isLoading}>
          {isLoading ? 'Saving…' : person ? 'Update' : 'Create'}
        </Button>
      </div>
    </form>
  );
}
