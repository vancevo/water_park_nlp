import type { GeoPoint } from '@damsen/shared-types';
import { geoDistanceMeters } from './route-simulation';

/** A GeoJSON walkway file: every feature is one edge between two path nodes. */
export interface WalkwayCollection {
  features: {
    geometry: { type: string; coordinates: number[][] };
  }[];
}

export const WALKWAYS_URL = '/data/damsen-walkways.geojson';

let cache: Promise<GeoPoint[]> | null = null;

/** The path nodes (the end points of every walkway edge), loaded once; [] when missing. */
export function loadWalkNodes(
  fetchImplementation: typeof fetch = fetch,
): Promise<GeoPoint[]> {
  cache ??= fetchImplementation(WALKWAYS_URL)
    .then(async (response) =>
      response.ok
        ? walkNodesOf((await response.json()) as WalkwayCollection)
        : [],
    )
    .catch(() => []);
  return cache;
}

/** The distinct end points of the walkway edges: these are the nodes the router starts from. */
export function walkNodesOf(collection: WalkwayCollection): GeoPoint[] {
  const nodes = new Map<string, GeoPoint>();
  for (const feature of collection.features) {
    if (feature.geometry.type !== 'LineString') continue;
    const line = feature.geometry.coordinates;
    for (const end of [line[0], line[line.length - 1]]) {
      const lng = end?.[0];
      const lat = end?.[1];
      if (lng === undefined || lat === undefined) continue;
      nodes.set(`${lng.toFixed(7)},${lat.toFixed(7)}`, {
        latitude: lat,
        longitude: lng,
      });
    }
  }
  return [...nodes.values()];
}

/**
 * Puts a point on the walkway network: the nearest path node within `maxMeters`. The route
 * starts at the nearest node, so a walker placed on a node starts exactly where the line
 * starts and never jumps. Null when no node is that close (the point stays where it was).
 */
export function snapToWalkNode(
  point: GeoPoint,
  nodes: readonly GeoPoint[],
  maxMeters = 120,
): { point: GeoPoint; distance: number } | null {
  let best: { point: GeoPoint; distance: number } | null = null;
  for (const node of nodes) {
    const distance = geoDistanceMeters(point, node);
    if (distance <= maxMeters && (!best || distance < best.distance)) {
      best = { point: node, distance };
    }
  }
  return best;
}
