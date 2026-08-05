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
        <div className="text-sm text-gray-500">Loading…</div>
      ) : interactions.length === 0 ? (
        <div className="text-sm text-gray-500">No interactions yet.</div>
      ) : (
        interactions.map((i) => {
          const person = getPerson(i.personId);
          return (
            <div key={i.id} className="flex items-center gap-3 p-3 rounded-lg border border-gray-100 bg-gray-50 text-sm">
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2">
                  <span className="font-medium text-gray-900 truncate">{person?.name ?? 'Unknown'}</span>
                  <Badge variant="secondary" className="text-xs shrink-0">{interactionTypeLabel(i.type)}</Badge>
                </div>
                {i.notes && <p className="text-xs text-gray-500 truncate mt-0.5">{i.notes}</p>}
              </div>
              <span className="text-xs text-gray-400 shrink-0">{formatRelative(i.occurredAt)}</span>
            </div>
          );
        })
      )}
      <Link to="/interactions" className="text-xs text-blue-600 hover:underline">
        View all interactions →
      </Link>
    </div>
  );
}
