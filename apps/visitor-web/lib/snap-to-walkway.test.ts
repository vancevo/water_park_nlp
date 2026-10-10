import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import type { WalkwayCollection } from './snap-to-walkway';
import { geoDistanceMeters } from './route-simulation';
import { snapToWalkNode, walkNodesOf } from './snap-to-walkway';

const collection = JSON.parse(
  readFileSync(
    join(import.meta.dirname, '../public/data/damsen-walkways.geojson'),
    'utf8',
  ),
) as WalkwayCollection;

describe('snap to the walkway', () => {
  it('collects the distinct end points of the edges as nodes', () => {
    const nodes = walkNodesOf(collection);
    // The same nodes the router has (data/walkways-new/graph.json, built from the same SVG).
    const graph = JSON.parse(
      readFileSync(
        join(import.meta.dirname, '../../../data/walkways-new/graph.json'),
        'utf8',
      ),
    ) as { nodes: unknown[] };
    expect(nodes.length).toBe(graph.nodes.length);
  });

  it('puts a point on the nearest node, within the limit', () => {
    const nodes = walkNodesOf(collection);
    const node = nodes[10]!;
    const near = {
      latitude: node.latitude + 0.00001,
      longitude: node.longitude + 0.00001,
    };
    const snapped = snapToWalkNode(near, nodes);
    // a node within a couple of metres (nodes may sit that close at a junction)
    expect(geoDistanceMeters(snapped!.point, node)).toBeLessThan(3);
    expect(snapped!.distance).toBeLessThan(3);
    expect(snapToWalkNode({ latitude: 11, longitude: 107 }, nodes)).toBeNull();
  });
});
