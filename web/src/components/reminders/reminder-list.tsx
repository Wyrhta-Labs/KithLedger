import { useState } from 'react';
import { Plus, Check, Clock, X, Trash2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogClose } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
  useReminders,
  useCreateReminder,
  useCompleteReminder,
  useSnoozeReminder,
  useDismissReminder,
  useDeleteReminder,
} from '@/hooks/use-reminders';
import { usePeople } from '@/hooks/use-people';
import { useToast } from '@/components/ui/toast';
import {
  formatDateTime,
  isOverdue,
  isDueToday,
  reminderStatusLabel,
  toApiDateTime,
} from '@/lib/format';
import { cn } from '@/lib/utils';
import ReminderForm from './reminder-form';
import type { Reminder } from '@/lib/types';

interface ReminderListProps {
  personId?: string;
  statusFilter?: string;
}

const statusBadge: Record<string, string> = {
  pending: 'secondary',
  done: 'success',
  snoozed: 'warning',
  dismissed: 'outline',
};

export default function ReminderList({ personId, statusFilter }: ReminderListProps) {
  const [showCreate, setShowCreate] = useState(false);
  const [snoozeId, setSnoozeId] = useState<string | null>(null);
  const [snoozeUntil, setSnoozeUntil] = useState('');
  const { toast } = useToast();

  const { data, isLoading } = useReminders({
    person_id: personId,
    status: statusFilter || undefined,
    limit: 50,
  });
  const { data: peopleData } = usePeople({ limit: 100 });
  const createMutation = useCreateReminder();
  const completeMutation = useCompleteReminder();
  const snoozeMutation = useSnoozeReminder();
  const dismissMutation = useDismissReminder();
  const deleteMutation = useDeleteReminder();

  const reminders = data?.data ?? [];
  const peopleOptions = peopleData?.data?.map((p) => ({ id: p.id, name: p.name })) ?? [];

  const sorted = [...reminders].sort((a, b) => {
    const aOverdue = isOverdue(a.dueAt) && a.status === 'pending';
    const bOverdue = isOverdue(b.dueAt) && b.status === 'pending';
    if (aOverdue && !bOverdue) return -1;
    if (!aOverdue && bOverdue) return 1;
    return new Date(a.dueAt).getTime() - new Date(b.dueAt).getTime();
  });

  const handleComplete = async (id: string) => {
    await completeMutation.mutateAsync(id);
    toast('Reminder completed!', 'success');
  };

  const handleSnooze = async () => {
    if (!snoozeId || !snoozeUntil) return;
    await snoozeMutation.mutateAsync({ id: snoozeId, snoozeUntil: toApiDateTime(snoozeUntil) });
    toast('Reminder snoozed', 'success');
    setSnoozeId(null);
    setSnoozeUntil('');
  };

  const handleDismiss = async (id: string) => {
    await dismissMutation.mutateAsync(id);
    toast('Reminder dismissed', 'success');
  };

  const handleDelete = async (id: string) => {
    if (!confirm('Delete this reminder?')) return;
    await deleteMutation.mutateAsync(id);
    toast('Reminder deleted', 'success');
  };

  const handleCreate = async (values: Parameters<typeof createMutation.mutateAsync>[0]) => {
    await createMutation.mutateAsync(values as Parameters<typeof createMutation.mutateAsync>[0]);
    toast('Reminder created', 'success');
    setShowCreate(false);
  };

  if (isLoading) return <div className="py-8 text-center text-gray-500">Loading…</div>;

  return (
    <div className="space-y-4">
      <div className="flex justify-end">
        <Button size="sm" onClick={() => setShowCreate(true)}>
          <Plus className="h-4 w-4" /> Add Reminder
        </Button>
      </div>

      {sorted.length === 0 ? (
        <div className="text-center py-8 text-gray-500">No reminders.</div>
      ) : (
        <div className="space-y-2">
          {sorted.map((reminder) => {
            const overdue = isOverdue(reminder.dueAt) && reminder.status === 'pending';
            const today = isDueToday(reminder.dueAt) && reminder.status === 'pending';
            return (
              <div
                key={reminder.id}
                className={cn(
                  'bg-white rounded-lg border p-4',
                  overdue ? 'border-red-300 bg-red-50' : today ? 'border-yellow-300 bg-yellow-50' : 'border-gray-200'
                )}
              >
                <div className="flex items-start justify-between gap-4">
                  <div className="flex-1">
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className={cn('font-medium text-sm', overdue && 'text-red-800', today && 'text-yellow-800')}>
                        {reminder.title}
                      </span>
                      <Badge variant={(statusBadge[reminder.status] as 'secondary' | 'success' | 'warning' | 'outline') ?? 'outline'}>
                        {reminderStatusLabel(reminder.status)}
                      </Badge>
                      {overdue && <Badge variant="destructive">Overdue</Badge>}
                      {today && <Badge variant="warning">Due Today</Badge>}
                      {reminder.recurrence && <Badge variant="outline">Recurring</Badge>}
                    </div>
                    <p className="text-xs text-gray-500 mt-1">{formatDateTime(reminder.dueAt)}</p>
                    {reminder.notes && <p className="text-sm text-gray-600 mt-1">{reminder.notes}</p>}
                  </div>
                  {reminder.status === 'pending' || reminder.status === 'snoozed' ? (
                    <div className="flex gap-1 shrink-0">
                      <Button variant="ghost" size="icon" className="h-7 w-7 text-green-600" title="Complete" onClick={() => handleComplete(reminder.id)}>
                        <Check className="h-4 w-4" />
                      </Button>
                      <Button variant="ghost" size="icon" className="h-7 w-7 text-blue-600" title="Snooze" onClick={() => { setSnoozeId(reminder.id); setSnoozeUntil(''); }}>
                        <Clock className="h-4 w-4" />
                      </Button>
                      <Button variant="ghost" size="icon" className="h-7 w-7 text-gray-500" title="Dismiss" onClick={() => handleDismiss(reminder.id)}>
                        <X className="h-4 w-4" />
                      </Button>
                    </div>
                  ) : (
                    <Button variant="ghost" size="icon" className="h-7 w-7 text-red-500" onClick={() => handleDelete(reminder.id)}>
                      <Trash2 className="h-3.5 w-3.5" />
                    </Button>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      )}

      <Dialog open={showCreate} onOpenChange={setShowCreate}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Set Reminder</DialogTitle>
            <DialogClose onClose={() => setShowCreate(false)} />
          </DialogHeader>
          <ReminderForm
            defaultPersonId={personId}
            personOptions={personId ? undefined : peopleOptions}
            onSubmit={handleCreate}
            onCancel={() => setShowCreate(false)}
            isLoading={createMutation.isPending}
          />
        </DialogContent>
      </Dialog>

      <Dialog open={!!snoozeId} onOpenChange={(open) => !open && setSnoozeId(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Snooze Reminder</DialogTitle>
            <DialogClose onClose={() => setSnoozeId(null)} />
          </DialogHeader>
          <div className="space-y-4">
            <div className="space-y-1">
              <Label htmlFor="snoozeUntil">Snooze until</Label>
              <Input
                id="snoozeUntil"
                type="datetime-local"
                value={snoozeUntil}
                onChange={(e) => setSnoozeUntil(e.target.value)}
              />
            </div>
            <div className="flex justify-end gap-2">
              <Button variant="outline" onClick={() => setSnoozeId(null)}>Cancel</Button>
              <Button onClick={handleSnooze} disabled={!snoozeUntil || snoozeMutation.isPending}>
                Snooze
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}
