import { useCallback } from 'react';
import ForceGraph2D from 'react-force-graph-2d';
import { useNavigate } from '@tanstack/react-router';
import { usePersonGraph } from '@/hooks/use-people';

const TYPE_COLORS: Record<string, string> = {
  friend: '#3b82f6',
  family: '#10b981',
  colleague: '#f59e0b',
  acquaintance: '#8b5cf6',
  other: '#6b7280',
};

interface GraphViewProps {
  personId: string;
  depth?: number;
  height?: number;
}

export default function GraphView({ personId, depth = 2, height = 400 }: GraphViewProps) {
  const { data, isLoading } = usePersonGraph(personId, depth);
  const navigate = useNavigate();

  const handleNodeClick = useCallback(
    (node: { id?: unknown }) => {
      if (node.id && node.id !== personId) {
        navigate({ to: '/people/$id', params: { id: String(node.id) } });
      }
    },
    [navigate, personId]
  );

  if (isLoading) return <div className="py-8 text-center text-gray-500">Loading graph…</div>;
  if (!data?.data) return <div className="py-8 text-center text-gray-500">No graph data.</div>;

  const { nodes, edges } = data.data;

  const graphData = {
    nodes: nodes.map((n) => ({
      id: n.id,
      name: n.name,
      depth: n.depth,
      color: n.id === personId ? '#1d4ed8' : '#3b82f6',
    })),
    links: edges.map((e) => ({
      source: e.source,
      target: e.target,
      type: e.type,
      color: TYPE_COLORS[e.type] ?? '#6b7280',
    })),
  };

  return (
    <div className="rounded-xl border border-gray-200 bg-white overflow-hidden">
      <ForceGraph2D
        graphData={graphData}
        width={undefined}
        height={height}
        nodeLabel="name"
        nodeColor={(node) => (node as { color: string }).color}
        linkColor={(link) => (link as { color: string }).color}
        linkDirectionalArrowLength={4}
        linkDirectionalArrowRelPos={1}
        onNodeClick={handleNodeClick}
        nodeCanvasObject={(node, ctx, globalScale) => {
          const n = node as { x?: number; y?: number; id?: string; name?: string; depth?: number };
          const x = n.x ?? 0;
          const y = n.y ?? 0;
          const label = n.name ?? '';
          const isRoot = n.id === personId;
          const r = isRoot ? 8 : 5;
          ctx.beginPath();
          ctx.arc(x, y, r, 0, 2 * Math.PI);
          ctx.fillStyle = isRoot ? '#1d4ed8' : (TYPE_COLORS[edges.find(e => e.source === n.id || e.target === n.id)?.type ?? ''] ?? '#3b82f6');
          ctx.fill();
          if (globalScale >= 1) {
            const fontSize = 12 / globalScale;
            ctx.font = `${fontSize}px Sans-Serif`;
            ctx.textAlign = 'center';
            ctx.textBaseline = 'middle';
            ctx.fillStyle = '#1f2937';
            ctx.fillText(label, x, y + r + fontSize);
          }
        }}
      />
      <div className="px-4 py-3 border-t border-gray-100 flex flex-wrap gap-3 text-xs text-gray-500">
        {Object.entries(TYPE_COLORS).map(([type, color]) => (
          <span key={type} className="flex items-center gap-1.5">
            <span className="w-3 h-3 rounded-full inline-block" style={{ backgroundColor: color }} />
            {type}
          </span>
        ))}
      </div>
    </div>
  );
}
