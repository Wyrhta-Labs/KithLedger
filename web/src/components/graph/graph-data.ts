import type { GraphData } from '@/lib/types';

export interface GraphPalette {
  types: Record<string, string>;
  root: string;
  node: string;
  other: string;
  label: string;
}

/** API graph → react-force-graph input. Edges arrive as relationship rows
 *  (`fromPersonId` → `toPersonId`); the canvas wants `source` → `target`. */
export function toGraphData({ nodes, edges }: GraphData, palette: GraphPalette) {
  return {
    nodes: nodes.map((n) => ({ id: n.id, name: n.name, color: palette.node })),
    links: edges.map((e) => ({
      source: e.fromPersonId,
      target: e.toPersonId,
      type: e.type,
      color: palette.types[e.type] ?? palette.other,
    })),
  };
}
