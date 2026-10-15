import { Link } from '@tanstack/react-router';
import { useInteractions } from '@/hooks/use-interactions';
import { usePeople } from '@/hooks/use-people';
import { formatRelative, interactionTypeLabel } from '@/lib/format';
import { Badge } from '@/components/ui/badge';
import { MAX_LIST_LIMIT } from '@/lib/constants';

export default function RecentInteractions() {
  const { data, isLoading } = useInteractions({ limit: 8 });
  const { data: peopleData } = usePeople({ limit: MAX_LIST_LIMIT });

  const interactions = data?.data ?? [];
  const people = peopleData?.data ?? [];
  const getPerson = (id: string) => people.find((p) => p.id === id);

  return (
    <div className="space-y-2">
      {isLoading ? (
        <div className="text-sm text-muted">Loading…</div>
      ) : interactions.length === 0 ? (
        <div className="text-sm text-muted">No interactions yet.</div>
      ) : (
        interactions.map((i) => {
          const person = getPerson(i.personId);
          return (
            <div key={i.id} className="flex items-center gap-3 p-3 rounded-lg border border-line bg-surface-2 text-sm">
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2">
                  <span className="font-medium text-fg truncate">{person?.name ?? 'Unknown'}</span>
                  <Badge variant="secondary" className="text-xs shrink-0">{interactionTypeLabel(i.type)}</Badge>
                </div>
                {i.notes && <p className="text-xs text-muted truncate mt-0.5">{i.notes}</p>}
              </div>
              <span className="text-xs text-faint shrink-0">{formatRelative(i.occurredAt)}</span>
            </div>
          );
        })
      )}
      <Link to="/interactions" className="text-xs text-primary hover:underline">
        View all interactions →
      </Link>
    </div>
  );
}
