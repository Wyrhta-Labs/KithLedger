import { useState } from 'react';
import { UserPlus, MessageSquarePlus, BellPlus } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogClose } from '@/components/ui/dialog';
import { useCreatePerson } from '@/hooks/use-people';
import { useCreateInteraction } from '@/hooks/use-interactions';
import { useCreateReminder } from '@/hooks/use-reminders';
import { usePeople } from '@/hooks/use-people';
import { useToast } from '@/components/ui/toast';
import PersonForm, { type PersonFormValues } from '@/components/people/person-form';
import InteractionForm, { type CleanInteractionFormValues } from '@/components/interactions/interaction-form';
import ReminderForm from '@/components/reminders/reminder-form';
import type { CreatePersonInput } from '@/api/people';
import type { CreateInteractionInput } from '@/api/interactions';
import type { CreateReminderInput } from '@/api/reminders';

export default function QuickActions() {
  const [modal, setModal] = useState<'person' | 'interaction' | 'reminder' | null>(null);
  const { toast } = useToast();
  const { data: peopleData } = usePeople({ limit: 100 });
  const createPerson = useCreatePerson();
  const createInteraction = useCreateInteraction();
  const createReminder = useCreateReminder();

  const peopleOptions = peopleData?.data?.map((p) => ({ id: p.id, name: p.name })) ?? [];

  return (
    <div className="flex flex-wrap gap-3">
      <Button variant="outline" onClick={() => setModal('person')}>
        <UserPlus className="h-4 w-4" /> Add Person
      </Button>
      <Button variant="outline" onClick={() => setModal('interaction')}>
        <MessageSquarePlus className="h-4 w-4" /> Log Interaction
      </Button>
      <Button variant="outline" onClick={() => setModal('reminder')}>
        <BellPlus className="h-4 w-4" /> Set Reminder
      </Button>

      <Dialog open={modal === 'person'} onOpenChange={(open) => !open && setModal(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Add Person</DialogTitle>
            <DialogClose onClose={() => setModal(null)} />
          </DialogHeader>
          <PersonForm
            onSubmit={async (v: PersonFormValues) => {
              await createPerson.mutateAsync(v as CreatePersonInput);
              toast('Person added', 'success');
              setModal(null);
            }}
            onCancel={() => setModal(null)}
            isLoading={createPerson.isPending}
          />
        </DialogContent>
      </Dialog>

      <Dialog open={modal === 'interaction'} onOpenChange={(open) => !open && setModal(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Log Interaction</DialogTitle>
            <DialogClose onClose={() => setModal(null)} />
          </DialogHeader>
          <InteractionForm
            personOptions={peopleOptions}
            onSubmit={async (v: CleanInteractionFormValues) => {
              await createInteraction.mutateAsync(v as CreateInteractionInput);
              toast('Interaction logged', 'success');
              setModal(null);
            }}
            onCancel={() => setModal(null)}
            isLoading={createInteraction.isPending}
          />
        </DialogContent>
      </Dialog>

      <Dialog open={modal === 'reminder'} onOpenChange={(open) => !open && setModal(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Set Reminder</DialogTitle>
            <DialogClose onClose={() => setModal(null)} />
          </DialogHeader>
          <ReminderForm
            personOptions={peopleOptions}
            onSubmit={async (v) => {
              await createReminder.mutateAsync(v as CreateReminderInput);
              toast('Reminder set', 'success');
              setModal(null);
            }}
            onCancel={() => setModal(null)}
            isLoading={createReminder.isPending}
          />
        </DialogContent>
      </Dialog>
    </div>
  );
}
