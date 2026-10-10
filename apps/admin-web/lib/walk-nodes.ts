/** One OSM path node of the routing graph (`osm-<id>` is its graph node ref). */
export interface WalkNode {
  ref: string;
  lon: number;
  lat: number;
}

export interface SnapResult {
  node: WalkNode;
  distanceMeters: number;
}

/** The API refuses to route from further than this to a path (RoutingService). */
export const MAX_SNAP_METERS = 75;

const EARTH_RADIUS_METERS = 6_371_000;

/** Great-circle distance; accurate to well under a metre at park scale. */
export function distanceMeters(
  a: { latitude: number; longitude: number },
  b: { latitude: number; longitude: number },
): number {
  const rad = Math.PI / 180;
  const dLat = (b.latitude - a.latitude) * rad;
  const dLon = (b.longitude - a.longitude) * rad;
  const h =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(a.latitude * rad) *
      Math.cos(b.latitude * rad) *
      Math.sin(dLon / 2) ** 2;
  return 2 * EARTH_RADIUS_METERS * Math.asin(Math.sqrt(h));
}

/** The path node closest to a point, or null when there are no nodes. */
export function nearestWalkNode(
  nodes: readonly WalkNode[],
  point: { latitude: number; longitude: number },
): SnapResult | null {
  let best: SnapResult | null = null;
  for (const node of nodes) {
    const distance = distanceMeters(point, {
      latitude: node.lat,
      longitude: node.lon,
    });
    if (!best || distance < best.distanceMeters) {
      best = { node, distanceMeters: distance };
    }
  }
  return best;
}

let cache: Promise<WalkNode[]> | undefined;

/** Loads `public/data/osm-walk-nodes.json` once (see scripts/export-walk-nodes.mjs). */
export function loadWalkNodes(
  fetchImplementation: typeof fetch = globalThis.fetch.bind(globalThis),
): Promise<WalkNode[]> {
  cache ??= fetchImplementation('/data/osm-walk-nodes.json')
    .then((response) => {
      if (!response.ok) throw new Error(`walk nodes ${response.status}`);
      return response.json() as Promise<WalkNode[]>;
    })
    .catch((error: unknown) => {
      cache = undefined; // let a later click retry
      throw error;
    });
  return cache;
}
