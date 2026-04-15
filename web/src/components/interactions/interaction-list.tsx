import { useState } from 'react';
import { Plus, Trash2, Edit2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogClose } from '@/components/ui/dialog';
import { useInteractions, useCreateInteraction, useUpdateInteraction, useDeleteInteraction } from '@/hooks/use-interactions';
import { usePeople } from '@/hooks/use-people';
import { useSettingValues } from '@/hooks/use-setting-values';
import { useToast } from '@/components/ui/toast';
import { formatDateTime, interactionTypeLabel, sentimentLabel } from '@/lib/format';
import { buildSettingValueLabelMap } from '@/lib/setting-values';
import { cn } from '@/lib/utils';
import InteractionForm, { type CleanInteractionFormValues } from './interaction-form';
import type { Interaction } from '@/lib/types';
import type { CreateInteractionInput, UpdateInteractionInput } from '@/api/interactions';

interface InteractionListProps {
  personId?: string;
}

const sentimentColors: Record<string, string> = {
  positive: 'border-l-green-400',
  neutral: 'border-l-gray-300',
  negative: 'border-l-red-400',
};

export default function InteractionList({ personId }: InteractionListProps) {
  const [showCreate, setShowCreate] = useState(false);
  const [editInteraction, setEditInteraction] = useState<Interaction | null>(null);
  const { toast } = useToast();

  const { data, isLoading } = useInteractions({ person_id: personId });
  const { data: peopleData } = usePeople({ limit: 100 });
  const { data: settingValuesData } = useSettingValues();
  const createMutation = useCreateInteraction();
  const updateMutation = useUpdateInteraction(editInteraction?.id ?? '');
  const deleteMutation = useDeleteInteraction();

  const interactions = data?.data ?? [];
  const peopleOptions = peopleData?.data?.map((p) => ({ id: p.id, name: p.name })) ?? [];
  const typeLabels = buildSettingValueLabelMap(settingValuesData?.data ?? [])['interaction.type'] ?? {};

  const handleCreate = async (values: CleanInteractionFormValues) => {
    await createMutation.mutateAsync(values as CreateInteractionInput);
    toast('Interaction logged', 'success');
    setShowCreate(false);
  };

  const handleUpdate = async (values: CleanInteractionFormValues) => {
    const { personId: _p, ...updateData } = values;
    await updateMutation.mutateAsync(updateData as UpdateInteractionInput);
    toast('Interaction updated', 'success');
    setEditInteraction(null);
  };

  const handleDelete = async (id: string) => {
    if (!confirm('Delete this interaction?')) return;
    await deleteMutation.mutateAsync(id);
    toast('Interaction deleted', 'success');
  };

  if (isLoading) return <div className="py-8 text-center text-gray-500">Loading…</div>;

  return (
    <div className="space-y-4">
      <div className="flex justify-end">
        <Button size="sm" onClick={() => setShowCreate(true)}>
          <Plus className="h-4 w-4" /> Log Interaction
        </Button>
      </div>

      {interactions.length === 0 ? (
        <div className="text-center py-8 text-gray-500">No interactions yet.</div>
      ) : (
        <div className="space-y-2">
          {interactions.map((interaction) => (
            <div
              key={interaction.id}
              className={cn(
                'bg-white rounded-lg border border-gray-200 border-l-4 p-4',
                sentimentColors[interaction.sentiment ?? 'neutral'] ?? 'border-l-gray-300'
              )}
            >
              <div className="flex items-start justify-between gap-4">
                <div className="flex-1">
                  <div className="flex items-center gap-2 flex-wrap">
                    <Badge variant="secondary">{interactionTypeLabel(interaction.type, typeLabels)}</Badge>
                    {interaction.sentiment && (
                      <Badge variant={interaction.sentiment === 'positive' ? 'success' : interaction.sentiment === 'negative' ? 'destructive' : 'outline'}>
                        {sentimentLabel(interaction.sentiment)}
                      </Badge>
                    )}
                    {interaction.channel && (
                      <span className="text-xs text-gray-500">via {interaction.channel}</span>
                    )}
                    <span className="text-xs text-gray-400 ml-auto">{formatDateTime(interaction.occurredAt)}</span>
                  </div>
                  {interaction.notes && (
                    <p className="text-sm text-gray-600 mt-2">{interaction.notes}</p>
                  )}
                </div>
                <div className="flex gap-1 shrink-0">
                  <Button variant="ghost" size="icon" className="h-7 w-7" onClick={() => setEditInteraction(interaction)}>
                    <Edit2 className="h-3.5 w-3.5" />
                  </Button>
                  <Button variant="ghost" size="icon" className="h-7 w-7 text-red-500" onClick={() => handleDelete(interaction.id)}>
                    <Trash2 className="h-3.5 w-3.5" />
                  </Button>
                </div>
              </div>
            </div>
          ))}
        </div>
      )}

      <Dialog open={showCreate} onOpenChange={setShowCreate}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Log Interaction</DialogTitle>
            <DialogClose onClose={() => setShowCreate(false)} />
          </DialogHeader>
          <InteractionForm
            defaultPersonId={personId}
            personOptions={personId ? undefined : peopleOptions}
            onSubmit={handleCreate}
            onCancel={() => setShowCreate(false)}
            isLoading={createMutation.isPending}
          />
        </DialogContent>
      </Dialog>

      <Dialog open={!!editInteraction} onOpenChange={(open) => !open && setEditInteraction(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Edit Interaction</DialogTitle>
            <DialogClose onClose={() => setEditInteraction(null)} />
          </DialogHeader>
          {editInteraction && (
            <InteractionForm
              interaction={editInteraction}
              personOptions={personId ? undefined : peopleOptions}
              onSubmit={handleUpdate}
              onCancel={() => setEditInteraction(null)}
              isLoading={updateMutation.isPending}
            />
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
}
