import { useState } from 'react';
import { Plus, Trash2, ArrowRight, ArrowLeftRight } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogClose } from '@/components/ui/dialog';
import { useRelationships, useCreateRelationship, useDeleteRelationship } from '@/hooks/use-relationships';
import { usePeople } from '@/hooks/use-people';
import { useToast } from '@/components/ui/toast';
import { relationshipTypeLabel } from '@/lib/format';
import RelationshipForm from './relationship-form';
import { MAX_LIST_LIMIT } from '@/lib/constants';

interface RelationshipListProps {
  personId?: string;
}

export default function RelationshipList({ personId }: RelationshipListProps) {
  const [showCreate, setShowCreate] = useState(false);
  const { toast } = useToast();

  const { data, isLoading } = useRelationships({ person_id: personId });
  const { data: peopleData } = usePeople({ limit: MAX_LIST_LIMIT });
  const createMutation = useCreateRelationship();
  const deleteMutation = useDeleteRelationship();

  const relationships = data?.data ?? [];
  const peopleOptions = peopleData?.data?.map((p) => ({ id: p.id, name: p.name })) ?? [];

  const getPerson = (id: string) => peopleOptions.find((p) => p.id === id);

  const handleCreate = async (values: Parameters<typeof createMutation.mutateAsync>[0]) => {
    await createMutation.mutateAsync(values as Parameters<typeof createMutation.mutateAsync>[0]);
    toast('Relationship added', 'success');
    setShowCreate(false);
  };

  const handleDelete = async (id: string) => {
    if (!confirm('Delete this relationship?')) return;
    await deleteMutation.mutateAsync(id);
    toast('Relationship deleted', 'success');
  };

  if (isLoading) return <div className="py-8 text-center text-gray-500">Loading…</div>;

  return (
    <div className="space-y-4">
      <div className="flex justify-end">
        <Button size="sm" onClick={() => setShowCreate(true)}>
          <Plus className="h-4 w-4" /> Add Relationship
        </Button>
      </div>

      {relationships.length === 0 ? (
        <div className="text-center py-8 text-gray-500">No relationships yet.</div>
      ) : (
        <div className="space-y-2">
          {relationships.map((rel) => {
            const fromPerson = getPerson(rel.fromPersonId);
            const toPerson = getPerson(rel.toPersonId);
            return (
              <div key={rel.id} className="bg-white rounded-lg border border-gray-200 p-4 flex items-center justify-between gap-4">
                <div className="flex items-center gap-3 flex-wrap">
                  <span className="font-medium text-sm text-gray-900">{fromPerson?.name ?? rel.fromPersonId}</span>
                  {rel.isMutual ? (
                    <ArrowLeftRight className="h-4 w-4 text-gray-400" />
                  ) : (
                    <ArrowRight className="h-4 w-4 text-gray-400" />
                  )}
                  <span className="font-medium text-sm text-gray-900">{toPerson?.name ?? rel.toPersonId}</span>
                  <Badge variant="secondary">{relationshipTypeLabel(rel.type)}</Badge>
                  {rel.label && <span className="text-xs text-gray-500 italic">"{rel.label}"</span>}
                </div>
                <Button
                  variant="ghost"
                  size="icon"
                  className="h-7 w-7 text-red-500 shrink-0"
                  onClick={() => handleDelete(rel.id)}
                >
                  <Trash2 className="h-3.5 w-3.5" />
                </Button>
              </div>
            );
          })}
        </div>
      )}

      <Dialog open={showCreate} onOpenChange={setShowCreate}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Add Relationship</DialogTitle>
            <DialogClose onClose={() => setShowCreate(false)} />
          </DialogHeader>
          <RelationshipForm
            defaultFromPersonId={personId}
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
