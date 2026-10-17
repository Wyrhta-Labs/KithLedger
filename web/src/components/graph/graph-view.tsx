import { useCallback, useRef, useState } from 'react';
import ForceGraph2D from 'react-force-graph-2d';
import { useNavigate } from '@tanstack/react-router';
import { usePersonGraph } from '@/hooks/use-people';
import { toGraphData } from './graph-data';

/** Relationship type → theme token. The canvas cannot read CSS variables,
 *  so `resolveTokens` turns them into colours once per render. */
const TYPE_TOKENS: Record<string, string> = {
  friend: '--color-info',
  family: '--color-success',
  colleague: '--color-warning',
  acquaintance: '--color-accent',
  other: '--color-muted',
};

function resolveTokens() {
  const css = getComputedStyle(document.documentElement);
  const read = (name: string) => css.getPropertyValue(name).trim();
  const types = Object.fromEntries(Object.entries(TYPE_TOKENS).map(([type, token]) => [type, read(token)]));
  return { types, root: read('--color-primary'), node: read('--color-primary'), other: read('--color-muted'), label: read('--color-fg') };
}

/**
 * The live content width of an element. react-force-graph falls back to
 * `window.innerWidth` without a width, which overflows the card and centres
 * the graph on the window instead of the card. A callback ref, because the
 * card mounts only once the graph has loaded.
 */
function useElementWidth() {
  const [width, setWidth] = useState<number>();
  const observer = useRef<ResizeObserver | null>(null);
  const ref = useCallback((el: HTMLElement | null) => {
    observer.current?.disconnect();
    observer.current = null;
    if (!el) return;
    setWidth(el.clientWidth);
    observer.current = new ResizeObserver(() => setWidth(el.clientWidth));
    observer.current.observe(el);
  }, []);
  return [ref, width] as const;
}

interface GraphViewProps {
  personId: string;
  depth?: number;
  height?: number;
}

export default function GraphView({ personId, depth = 2, height = 400 }: GraphViewProps) {
  const { data, isLoading } = usePersonGraph(personId, depth);
  const navigate = useNavigate();
  const [cardRef, width] = useElementWidth();

  const handleNodeClick = useCallback(
    (node: { id?: unknown }) => {
      if (node.id && node.id !== personId) {
        navigate({ to: '/people/$id', params: { id: String(node.id) } });
      }
    },
    [navigate, personId]
  );

  if (isLoading) return <div className="py-8 text-center text-muted">Loading graph…</div>;
  if (!data?.data) return <div className="py-8 text-center text-muted">No graph data.</div>;

  const { edges } = data.data;
  const palette = resolveTokens();
  const graphData = toGraphData(data.data, palette);

  return (
    <div ref={cardRef} data-testid="graph-card" className="rounded-card border border-line bg-surface overflow-hidden">
      <ForceGraph2D
        graphData={graphData}
        width={width}
        height={height}
        nodeLabel="name"
        nodeColor={(node) => (node as { color: string }).color}
        linkColor={(link) => (link as { color: string }).color}
        linkDirectionalArrowLength={4}
        linkDirectionalArrowRelPos={1}
        onNodeClick={handleNodeClick}
        nodeCanvasObject={(node, ctx, globalScale) => {
          const n = node as { x?: number; y?: number; id?: string; name?: string };
          const x = n.x ?? 0;
          const y = n.y ?? 0;
          const label = n.name ?? '';
          const isRoot = n.id === personId;
          const r = isRoot ? 8 : 5;
          ctx.beginPath();
          ctx.arc(x, y, r, 0, 2 * Math.PI);
          ctx.fillStyle = isRoot ? palette.root : (palette.types[edges.find(e => e.fromPersonId === n.id || e.toPersonId === n.id)?.type ?? ''] ?? palette.node);
          ctx.fill();
          if (globalScale >= 1) {
            const fontSize = 12 / globalScale;
            ctx.font = `${fontSize}px Sans-Serif`;
            ctx.textAlign = 'center';
            ctx.textBaseline = 'middle';
            ctx.fillStyle = palette.label;
            ctx.fillText(label, x, y + r + fontSize);
          }
        }}
      />
      <div className="px-4 py-3 border-t border-line flex flex-wrap gap-3 text-xs text-muted">
        {Object.entries(TYPE_TOKENS).map(([type, token]) => (
          <span key={type} className="flex items-center gap-1.5">
            <span className="w-3 h-3 rounded-full inline-block" style={{ backgroundColor: `var(${token})` }} />
            {type}
          </span>
        ))}
      </div>
    </div>
  );
}
