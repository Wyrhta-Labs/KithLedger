import { useCallback } from 'react';
import ForceGraph2D from 'react-force-graph-2d';
import { useNavigate } from '@tanstack/react-router';
import { useGlobalGraph, usePersonGraph } from '@/hooks/use-people';
import { useSettingValues } from '@/hooks/use-setting-values';
import { buildSettingValueLabelMap, getSettingValuesForCategory, humanizeSettingValue } from '@/lib/setting-values';
import type { GraphEdge, GraphNode } from '@/lib/types';

const GRAPH_COLORS = ['#3b82f6', '#10b981', '#f59e0b', '#ef4444', '#8b5cf6', '#14b8a6', '#6b7280'];
const ALL_ITEMS_ROOT_ID = '__me__';

type GraphMode = 'person' | 'all';

interface GraphViewProps {
  mode?: GraphMode;
  personId?: string;
  depth?: number;
  height?: number;
}

export default function GraphView({ mode = 'person', personId, depth = 2, height = 400 }: GraphViewProps) {
  const personGraph = usePersonGraph(mode === 'person' ? (personId ?? '') : '', depth);
  const globalGraph = useGlobalGraph(mode === 'all');
  const { data: settingValuesData } = useSettingValues();
  const navigate = useNavigate();
  const isAllMode = mode === 'all';
  const activeGraph = isAllMode ? globalGraph : personGraph;
  const activeRootId = isAllMode ? ALL_ITEMS_ROOT_ID : personId;

  const handleNodeClick = useCallback(
    (node: { id?: unknown }) => {
      if (node.id && node.id !== ALL_ITEMS_ROOT_ID && node.id !== personId) {
        navigate({ to: '/people/$id', params: { id: String(node.id) } });
      }
    },
    [navigate, personId]
  );

  if (activeGraph.isLoading) return <div className="py-8 text-center text-gray-500">Loading graph…</div>;
  if (!activeGraph.data?.data) return <div className="py-8 text-center text-gray-500">No graph data.</div>;

  const { nodes, edges } = activeGraph.data.data;
  const relationshipTypes = getSettingValuesForCategory(settingValuesData?.data ?? [], 'relationship.type');
  const relationshipLabels = buildSettingValueLabelMap(settingValuesData?.data ?? [])['relationship.type'] ?? {};
  const typeColors = relationshipTypes.reduce<Record<string, string>>((acc, type, index) => {
    acc[type.value] = GRAPH_COLORS[index % GRAPH_COLORS.length];
    return acc;
  }, {});
  const nodeIds = new Set(nodes.map((node) => node.id));
  const safeEdges = edges.filter(
    (edge): edge is GraphEdge =>
      typeof edge.source === 'string' &&
      typeof edge.target === 'string' &&
      nodeIds.has(edge.source) &&
      nodeIds.has(edge.target)
  );

  const safeNodes = isAllMode
    ? [
        { id: ALL_ITEMS_ROOT_ID, name: 'Me', depth: 0 },
        ...nodes.map((node) => ({ ...node, depth: Math.max(1, node.depth ?? 1) })),
      ]
    : nodes;

  const graphData = {
    nodes: safeNodes.map((n) => ({
      id: n.id,
      name: n.name,
      depth: n.depth ?? 0,
      color: n.id === activeRootId ? '#1d4ed8' : '#3b82f6',
      fx: n.id === ALL_ITEMS_ROOT_ID ? 0 : undefined,
      fy: n.id === ALL_ITEMS_ROOT_ID ? 0 : undefined,
    })),
    links: [
      ...safeEdges.map((e) => ({
        source: e.source,
        target: e.target,
        type: e.type,
        color: typeColors[e.type] ?? '#6b7280',
      })),
      ...(isAllMode
        ? nodes.map((node) => ({
            source: ALL_ITEMS_ROOT_ID,
            target: node.id,
            type: '__self__',
            color: '#cbd5e1',
          }))
        : []),
    ],
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
          const n = node as GraphNode & { x?: number; y?: number; color?: string };
          const x = n.x ?? 0;
          const y = n.y ?? 0;
          const label = n.name ?? '';
          const isRoot = n.id === activeRootId;
          const r = isRoot ? 8 : 5;
          ctx.beginPath();
          ctx.arc(x, y, r, 0, 2 * Math.PI);
          ctx.fillStyle =
            isRoot
              ? '#1d4ed8'
              : n.id === ALL_ITEMS_ROOT_ID
                ? '#1d4ed8'
                : (typeColors[safeEdges.find((edge) => edge.source === n.id || edge.target === n.id)?.type ?? ''] ?? '#3b82f6');
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
        {isAllMode ? (
          <span className="flex items-center gap-1.5">
            <span className="w-3 h-3 rounded-full inline-block" style={{ backgroundColor: '#cbd5e1' }} />
            Me link
          </span>
        ) : null}
        {(relationshipTypes.length > 0 ? relationshipTypes : [{ value: 'other', label: 'Other' } as const]).map((type, index) => (
          <span key={type.value} className="flex items-center gap-1.5">
            <span className="w-3 h-3 rounded-full inline-block" style={{ backgroundColor: typeColors[type.value] ?? GRAPH_COLORS[index % GRAPH_COLORS.length] }} />
            {relationshipLabels[type.value] ?? humanizeSettingValue(type.value)}
          </span>
        ))}
      </div>
    </div>
  );
}
