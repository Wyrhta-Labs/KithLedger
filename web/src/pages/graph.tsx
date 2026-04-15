import { useState } from 'react';
import { Search, Sliders } from 'lucide-react';
import { Input } from '@/components/ui/input';
import { Select } from '@/components/ui/select';
import { Card, CardContent } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { usePeople } from '@/hooks/use-people';
import GraphView from '@/components/graph/graph-view';

export default function GraphPage() {
  const [mode, setMode] = useState<'person' | 'all'>('person');
  const [search, setSearch] = useState('');
  const [selectedPersonId, setSelectedPersonId] = useState('');
  const [depth, setDepth] = useState(2);

  const { data: peopleData } = usePeople({ q: search || undefined, limit: 20 });
  const people = peopleData?.data ?? [];
  const isAllMode = mode === 'all';

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-4">
        <Select
          value={mode}
          onChange={(e) => setMode(e.target.value as 'person' | 'all')}
          className="w-44"
        >
          <option value="person">Person graph</option>
          <option value="all">All items</option>
        </Select>
        {!isAllMode ? (
          <>
            <div className="relative flex-1 max-w-sm">
              <Search className="absolute left-3 top-2.5 h-4 w-4 text-gray-400 pointer-events-none" />
              <Input
                placeholder="Search for a person…"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                className="pl-9"
              />
            </div>
            {people.length > 0 && (
              <Select
                value={selectedPersonId}
                onChange={(e) => setSelectedPersonId(e.target.value)}
                className="w-52"
              >
                <option value="">Select person to explore</option>
                {people.map((p) => (
                  <option key={p.id} value={p.id}>{p.name}</option>
                ))}
              </Select>
            )}
          </>
        ) : (
          <Badge variant="secondary">Shows every person and relationship</Badge>
        )}
        <div className="flex items-center gap-2">
          <Sliders className="h-4 w-4 text-gray-500" />
          <Select
            value={String(depth)}
            onChange={(e) => setDepth(Number(e.target.value))}
            className="w-28"
            disabled={isAllMode}
          >
            <option value="1">Depth 1</option>
            <option value="2">Depth 2</option>
            <option value="3">Depth 3</option>
          </Select>
        </div>
      </div>

      {!isAllMode && !selectedPersonId ? (
        <Card>
          <CardContent className="py-16 text-center text-gray-500">
            <p>Search for a person and select them to explore their relationship graph.</p>
          </CardContent>
        </Card>
      ) : (
        <GraphView mode={mode} personId={selectedPersonId} depth={depth} height={600} />
      )}
    </div>
  );
}
