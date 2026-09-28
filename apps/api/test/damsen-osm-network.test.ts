import { describe, expect, it } from 'vitest';

import {
  DAMSEN_OSM_WALK_NODES,
  DAMSEN_OSM_WALK_WAYS,
} from '../src/routing/damsen-osm-network.js';

const destinationNodeIds = [
  1274408728, 11301680998, 366406286, 3700972516, 3806809695,
];

describe('Dam Sen OSM research network', () => {
  it('keeps the snapshot connected and contains every dev destination', () => {
    expect(DAMSEN_OSM_WALK_WAYS).toHaveLength(54);
    expect(DAMSEN_OSM_WALK_NODES).toHaveLength(360);

    const adjacency = new Map<number, Set<number>>(
      DAMSEN_OSM_WALK_NODES.map((node) => [node.id, new Set<number>()]),
    );
    for (const way of DAMSEN_OSM_WALK_WAYS) {
      way.nodeIds.slice(1).forEach((target, index) => {
        const source = way.nodeIds[index]!;
        adjacency.get(source)?.add(target);
        adjacency.get(target)?.add(source);
      });
    }

    const visited = new Set<number>();
    const pending = [DAMSEN_OSM_WALK_NODES[0]!.id];
    while (pending.length > 0) {
      const current = pending.pop()!;
      if (visited.has(current)) continue;
      visited.add(current);
      pending.push(
        ...[...(adjacency.get(current) ?? [])].filter(
          (neighbor) => !visited.has(neighbor),
        ),
      );
    }

    expect(visited.size).toBe(DAMSEN_OSM_WALK_NODES.length);
    expect(destinationNodeIds.every((id) => visited.has(id))).toBe(true);
  });
});
