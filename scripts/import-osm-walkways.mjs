// Import the OSM research walkway snapshot into the routing graph (walk_nodes /
// walk_edges) so real POIs can be routed to on the real paths:
//
//   npm run build --workspace @damsen/api && node scripts/import-osm-walkways.mjs
//
// Idempotent (ON CONFLICT DO NOTHING) and additive: the synthetic fixture graph
// (N1–N7) is left untouched. Nodes are `osm-<nodeId>`, edges `osm-<wayId>-<i>`.
// Research data, not field verified (B01): accessibility is unknown → 'standard'.
import { Console } from 'node:console';
import process from 'node:process';

import pg from 'pg';

import {
  DAMSEN_OSM_WALK_NODES,
  DAMSEN_OSM_WALK_WAYS,
} from '../apps/api/dist/routing/damsen-osm-network.js';

const logger = new Console({ stdout: process.stdout, stderr: process.stderr });
const SOURCE = 'openstreetmap_research_2026-09-27';
const EDGE_ID_BASE = 9_000_000_000n;
const pool = new pg.Pool({
  connectionString:
    process.env.DATABASE_URL ??
    'postgresql://damsen:damsen_local_only@127.0.0.1:64321/damsen',
  max: 1,
});

const nodes = new Map(DAMSEN_OSM_WALK_NODES.map((node) => [node.id, node]));
const client = await pool.connect();
try {
  await client.query('BEGIN');
  let nodeCount = 0;
  let edgeCount = 0;
  const used = new Set();
  for (const way of DAMSEN_OSM_WALK_WAYS) {
    for (const id of way.nodeIds) used.add(id);
  }
  for (const id of used) {
    const node = nodes.get(id);
    if (!node) throw new Error(`way references unknown node ${id}`);
    const result = await client.query(
      `INSERT INTO walk_nodes (id, external_id, location, kind, source)
       VALUES ($1, $2, ST_SetSRID(ST_MakePoint($3, $4), 4326), 'junction', $5)
       ON CONFLICT DO NOTHING`,
      [id, `osm-${id}`, node.longitude, node.latitude, SOURCE],
    );
    nodeCount += result.rowCount ?? 0;
  }
  let sequence = 0n;
  for (const way of DAMSEN_OSM_WALK_WAYS) {
    for (let i = 0; i + 1 < way.nodeIds.length; i += 1) {
      sequence += 1n;
      const a = nodes.get(way.nodeIds[i]);
      const b = nodes.get(way.nodeIds[i + 1]);
      if (a.id === b.id) continue;
      const result = await client.query(
        `WITH g AS (
           SELECT ST_SetSRID(ST_MakeLine(ST_MakePoint($4, $5), ST_MakePoint($6, $7)), 4326) AS geom
         )
         INSERT INTO walk_edges (id, external_id, source, target, geom, length_m, cost, reverse_cost,
                                 accessibility, status, surface, source_name)
         SELECT $1, $2, $8, $9, geom, ST_Length(geom::geography), ST_Length(geom::geography),
                ST_Length(geom::geography), 'standard', 'open', 'unknown', $3
         FROM g WHERE ST_Length(geom::geography) > 0
         ON CONFLICT DO NOTHING`,
        [
          (EDGE_ID_BASE + sequence).toString(),
          `osm-${way.osmId}-${i}`,
          SOURCE,
          a.longitude,
          a.latitude,
          b.longitude,
          b.latitude,
          a.id,
          b.id,
        ],
      );
      edgeCount += result.rowCount ?? 0;
    }
  }
  await client.query('COMMIT');
  logger.log(`imported ${nodeCount} nodes and ${edgeCount} edges (${SOURCE})`);
} catch (error) {
  await client.query('ROLLBACK');
  throw error;
} finally {
  client.release();
  await pool.end();
}
