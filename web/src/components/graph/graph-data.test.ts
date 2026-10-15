import { describe, it, expect } from 'vitest';
import { toGraphData } from './graph-data';
import type { GraphData } from '@/lib/types';

const palette = { types: { friend: '#00f', family: '#0f0' }, root: '#111', node: '#222', other: '#333', label: '#444' };

// The shape GET /people/:id/graph actually returns: nodes without depth,
// edges as relationship rows keyed by fromPersonId/toPersonId.
const api: GraphData = {
  nodes: [
    { id: 'a', name: 'Ann' },
    { id: 'b', name: 'Ben' },
    { id: 'c', name: 'Cat' },
  ],
  edges: [
    { id: 'r1', fromPersonId: 'a', toPersonId: 'b', type: 'friend', isMutual: true },
    { id: 'r2', fromPersonId: 'b', toPersonId: 'c', type: 'neighbour', isMutual: false },
  ],
};

describe('toGraphData', () => {
  it('links each edge between its two people', () => {
    const { links } = toGraphData(api, palette);
    expect(links.map((l) => [l.source, l.target])).toEqual([['a', 'b'], ['b', 'c']]);
  });

  it('only links people that are among the nodes', () => {
    const { nodes, links } = toGraphData(api, palette);
    const ids = new Set(nodes.map((n) => n.id));
    for (const l of links) {
      expect(ids.has(l.source)).toBe(true);
      expect(ids.has(l.target)).toBe(true);
    }
  });

  it('colours links by type, falling back to "other"', () => {
    const { links } = toGraphData(api, palette);
    expect(links.map((l) => l.color)).toEqual(['#00f', '#333']);
  });
});
