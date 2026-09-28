import type { SqlClient } from '../poi/postgres-poi.repository.js';
import type {
  RouteDestination,
  RouteSegment,
  RoutingRepository,
  SnappedNode,
} from './routing.models.js';

export class PostgresRoutingRepository implements RoutingRepository {
  constructor(private readonly client: SqlClient) {}

  async findDestination(poiId: string): Promise<RouteDestination | null> {
    const result = await this.client.query<{
      node_id: number | string;
      external_node_id: string;
    }>(
      `SELECT n.id AS node_id, n.external_id AS external_node_id
       FROM pois p
       JOIN poi_entrances pe ON pe.poi_id = p.id
       JOIN walk_nodes n ON n.external_id = pe.graph_node_ref
       WHERE p.id = $1 AND p.status = 'published'
         AND pe.is_primary AND pe.is_active
       ORDER BY pe.id LIMIT 1`,
      [poiId],
    );
    const row = result.rows[0];
    return row
      ? { nodeId: Number(row.node_id), externalNodeId: row.external_node_id }
      : null;
  }

  async snapOrigin(
    latitude: number,
    longitude: number,
    maxMeters: number,
  ): Promise<SnappedNode | null> {
    const result = await this.client.query<{
      id: number | string;
      longitude: number | string;
      latitude: number | string;
      distance_m: number | string;
    }>(
      `WITH origin AS (
         SELECT ST_SetSRID(ST_MakePoint($1, $2), 4326) AS geom
       )
       SELECT n.id, ST_X(n.location) AS longitude, ST_Y(n.location) AS latitude,
         ST_Distance(n.location::geography, origin.geom::geography) AS distance_m
       FROM walk_nodes n CROSS JOIN origin
       WHERE ST_DWithin(n.location::geography, origin.geom::geography, $3)
         AND EXISTS (
           SELECT 1 FROM walk_edges e
           WHERE e.status = 'open' AND (e.source = n.id OR e.target = n.id)
         )
       ORDER BY n.location <-> origin.geom, n.id
       LIMIT 1`,
      [longitude, latitude, maxMeters],
    );
    const row = result.rows[0];
    return row
      ? {
          id: Number(row.id),
          longitude: Number(row.longitude),
          latitude: Number(row.latitude),
          distanceMeters: Number(row.distance_m),
        }
      : null;
  }

  async findPath(
    startNodeId: number,
    endNodeId: number,
    accessible: boolean,
  ): Promise<RouteSegment[]> {
    const accessibilityPredicate = accessible
      ? "AND accessibility <> 'stairs'"
      : '';
    const edgeSql = `
      SELECT id, source, target, cost, reverse_cost
      FROM walk_edges
      WHERE status = 'open' ${accessibilityPredicate}`;
    const result = await this.client.query<{
      sequence: number | string;
      edge_id: number | string;
      edge_name: string;
      distance_m: number | string;
      geometry: RouteSegment['geometry'] | string;
    }>(
      `SELECT route.seq AS sequence, edge.id AS edge_id,
         edge.external_id AS edge_name, edge.length_m AS distance_m,
         ST_AsGeoJSON(
           CASE WHEN route.node = edge.source THEN edge.geom ELSE ST_Reverse(edge.geom) END
         )::json AS geometry
       FROM pgr_dijkstra(
         $1::text, $2::bigint, $3::bigint, directed := true
       ) route
       JOIN walk_edges edge ON edge.id = route.edge
       WHERE route.edge <> -1
       ORDER BY route.seq`,
      [edgeSql, startNodeId, endNodeId],
    );
    return result.rows.map((row) => ({
      sequence: Number(row.sequence),
      edgeId: Number(row.edge_id),
      edgeName: row.edge_name,
      distanceMeters: Number(row.distance_m),
      geometry:
        typeof row.geometry === 'string'
          ? (JSON.parse(row.geometry) as RouteSegment['geometry'])
          : row.geometry,
    }));
  }
}
