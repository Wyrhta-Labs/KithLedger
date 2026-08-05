import { useState } from 'react';
import { Plus } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Select } from '@/components/ui/select';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogClose } from '@/components/ui/dialog';
import { Badge } from '@/components/ui/badge';
import { useInteractions, useCreateInteraction, useDeleteInteraction } from '@/hooks/use-interactions';
import { usePeople } from '@/hooks/use-people';
import { useToast } from '@/components/ui/toast';
import { formatDateTime, interactionTypeLabel, sentimentLabel } from '@/lib/format';
import { INTERACTION_TYPES, MAX_LIST_LIMIT } from '@/lib/constants';
import InteractionForm, { type CleanInteractionFormValues } from '@/components/interactions/interaction-form';
import type { Interaction } from '@/lib/types';
import type { CreateInteractionInput } from '@/api/interactions';

export default function InteractionsPage() {
  const [typeFilter, setTypeFilter] = useState('');
  const [showCreate, setShowCreate] = useState(false);
  const [page, setPage] = useState(0);
  const { toast } = useToast();

  const limit = 20;
  const { data, isLoading } = useInteractions({
    type: typeFilter || undefined,
    limit,
    offset: page * limit,
  });
  const { data: peopleData } = usePeople({ limit: MAX_LIST_LIMIT });
  const createMutation = useCreateInteraction();
  const deleteMutation = useDeleteInteraction();

  const interactions = data?.data ?? [];
  const total = data?.meta?.total ?? 0;
  const people = peopleData?.data ?? [];
  const getPerson = (id: string) => people.find((p) => p.id === id);
  const peopleOptions = people.map((p) => ({ id: p.id, name: p.name }));

  const handleCreate = async (values: CleanInteractionFormValues) => {
    await createMutation.mutateAsync(values as CreateInteractionInput);
    toast('Interaction logged', 'success');
    setShowCreate(false);
  };

  const handleDelete = async (id: string) => {
    if (!confirm('Delete this interaction?')) return;
    await deleteMutation.mutateAsync(id);
    toast('Interaction deleted', 'success');
  };

  const sentimentBadgeVariant = (s: Interaction['sentiment']): 'success' | 'destructive' | 'outline' => {
    if (s === 'positive') return 'success';
    if (s === 'negative') return 'destructive';
    return 'outline';
  };

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between gap-4">
        <div className="flex items-center gap-3">
          <Select
            value={typeFilter}
            onChange={(e) => { setTypeFilter(e.target.value); setPage(0); }}
            className="w-40"
          >
            <option value="">All types</option>
            {INTERACTION_TYPES.map((t) => (
              <option key={t.value} value={t.value}>{t.label}</option>
            ))}
          </Select>
        </div>
        <Button onClick={() => setShowCreate(true)}>
          <Plus className="h-4 w-4" /> Log Interaction
        </Button>
      </div>

      {isLoading ? (
        <div className="text-center py-12 text-gray-500">Loading…</div>
      ) : interactions.length === 0 ? (
        <div className="text-center py-12 text-gray-500">No interactions found.</div>
      ) : (
        <div className="space-y-3">
          {interactions.map((i) => {
            const person = getPerson(i.personId);
            return (
              <div key={i.id} className="bg-white rounded-xl border border-gray-200 p-4">
                <div className="flex items-start justify-between gap-4">
                  <div className="flex-1 space-y-1">
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className="font-medium text-gray-900">{person?.name ?? 'Unknown'}</span>
                      <Badge variant="secondary">{interactionTypeLabel(i.type)}</Badge>
                      {i.sentiment && (
                        <Badge variant={sentimentBadgeVariant(i.sentiment)}>
                          {sentimentLabel(i.sentiment)}
                        </Badge>
                      )}
                      {i.channel && <span className="text-xs text-gray-500">via {i.channel}</span>}
                    </div>
                    {i.notes && <p className="text-sm text-gray-600">{i.notes}</p>}
                    <p className="text-xs text-gray-400">{formatDateTime(i.occurredAt)}</p>
                  </div>
                  <Button
                    variant="ghost"
                    size="sm"
                    className="text-red-500 hover:text-red-700 shrink-0"
                    onClick={() => handleDelete(i.id)}
                  >
                    Delete
                  </Button>
                </div>
              </div>
            );
          })}
        </div>
      )}

      {total > limit && (
        <div className="flex items-center justify-between text-sm text-gray-500">
          <span>Showing {page * limit + 1}–{Math.min((page + 1) * limit, total)} of {total}</span>
          <div className="flex gap-2">
            <Button variant="outline" size="sm" disabled={page === 0} onClick={() => setPage(p => p - 1)}>Previous</Button>
            <Button variant="outline" size="sm" disabled={(page + 1) * limit >= total} onClick={() => setPage(p => p + 1)}>Next</Button>
          </div>
        </div>
      )}

      <Dialog open={showCreate} onOpenChange={setShowCreate}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Log Interaction</DialogTitle>
            <DialogClose onClose={() => setShowCreate(false)} />
          </DialogHeader>
          <InteractionForm
            personOptions={peopleOptions}
            onSubmit={handleCreate}
            onCancel={() => setShowCreate(false)}
            isLoading={createMutation.isPending}
          />
        </DialogContent>
      </Dialog>
    </div>
  );
}
