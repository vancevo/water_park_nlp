import type {
  RouteDestination,
  RouteSegment,
  RoutingRepository,
  SnappedNode,
} from './routing.models.js';
import {
  DAMSEN_OSM_WALK_NODES,
  DAMSEN_OSM_WALK_WAYS,
} from './damsen-osm-network.js';

interface Node {
  id: number;
  externalId: string;
  latitude: number;
  longitude: number;
}
interface Edge {
  id: number;
  name: string;
  source: number;
  target: number;
  accessible: boolean;
}

const nodes: Node[] = DAMSEN_OSM_WALK_NODES.map((node) => ({
  ...node,
  externalId: `OSM-${node.id}`,
}));

let nextEdgeId = 1;
const edges: Edge[] = DAMSEN_OSM_WALK_WAYS.flatMap((way) =>
  way.nodeIds.slice(1).map((target, index) => ({
    id: nextEdgeId++,
    name: way.name,
    source: way.nodeIds[index]!,
    target,
    accessible: way.accessible,
  })),
);
const poiNodes = new Map<string, number>([
  ['00000000-0000-4000-8000-000000000101', 1274408728],
  ['00000000-0000-4000-8000-000000000102', 11301680998],
  ['00000000-0000-4000-8000-000000000103', 366406286],
  ['00000000-0000-4000-8000-000000000104', 3700972516],
  ['00000000-0000-4000-8000-000000000105', 3806809695],
]);

function distanceMeters(
  a: Pick<Node, 'latitude' | 'longitude'>,
  b: Pick<Node, 'latitude' | 'longitude'>,
): number {
  const radians = Math.PI / 180;
  const dLat = (b.latitude - a.latitude) * radians;
  const dLng = (b.longitude - a.longitude) * radians;
  const value =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(a.latitude * radians) *
      Math.cos(b.latitude * radians) *
      Math.sin(dLng / 2) ** 2;
  return 6_371_008.8 * 2 * Math.atan2(Math.sqrt(value), Math.sqrt(1 - value));
}

export class InMemoryRoutingRepository implements RoutingRepository {
  async findDestination(poiId: string): Promise<RouteDestination | null> {
    const nodeId = poiNodes.get(poiId);
    const node = nodes.find((candidate) => candidate.id === nodeId);
    return node ? { nodeId: node.id, externalNodeId: node.externalId } : null;
  }

  async snapOrigin(
    latitude: number,
    longitude: number,
    maxMeters: number,
  ): Promise<SnappedNode | null> {
    const candidates = nodes
      .map((node) => ({
        node,
        distance: distanceMeters({ latitude, longitude }, node),
      }))
      .sort((a, b) => a.distance - b.distance || a.node.id - b.node.id);
    const match = candidates[0];
    return match && match.distance <= maxMeters
      ? {
          id: match.node.id,
          longitude: match.node.longitude,
          latitude: match.node.latitude,
          distanceMeters: match.distance,
        }
      : null;
  }

  async findPath(
    startNodeId: number,
    endNodeId: number,
    accessible: boolean,
  ): Promise<RouteSegment[]> {
    const distances = new Map<number, number>([[startNodeId, 0]]);
    const previous = new Map<number, { node: number; edge: Edge }>();
    const remaining = new Set(nodes.map((node) => node.id));
    while (remaining.size > 0) {
      const current = [...remaining].sort(
        (a, b) =>
          (distances.get(a) ?? Infinity) - (distances.get(b) ?? Infinity),
      )[0]!;
      remaining.delete(current);
      if (
        current === endNodeId ||
        !Number.isFinite(distances.get(current) ?? Infinity)
      )
        break;
      for (const edge of edges.filter(
        (item) =>
          (!accessible || item.accessible) &&
          (item.source === current || item.target === current),
      )) {
        const next = edge.source === current ? edge.target : edge.source;
        const from = nodes.find((node) => node.id === current)!;
        const to = nodes.find((node) => node.id === next)!;
        const candidate = distances.get(current)! + distanceMeters(from, to);
        if (candidate < (distances.get(next) ?? Infinity)) {
          distances.set(next, candidate);
          previous.set(next, { node: current, edge });
        }
      }
    }
    if (startNodeId !== endNodeId && !previous.has(endNodeId)) return [];
    const path: Array<{ from: number; to: number; edge: Edge }> = [];
    for (let cursor = endNodeId; cursor !== startNodeId; ) {
      const item = previous.get(cursor);
      if (!item) return [];
      path.unshift({ from: item.node, to: cursor, edge: item.edge });
      cursor = item.node;
    }
    return path.map((item, index) => {
      const from = nodes.find((node) => node.id === item.from)!;
      const to = nodes.find((node) => node.id === item.to)!;
      return {
        sequence: index + 1,
        edgeId: item.edge.id,
        edgeName: item.edge.name,
        distanceMeters: distanceMeters(from, to),
        geometry: {
          type: 'LineString',
          coordinates: [
            [from.longitude, from.latitude],
            [to.longitude, to.latitude],
          ],
        },
      };
    });
  }
}
