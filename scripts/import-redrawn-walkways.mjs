/* global process */
// Loads the footpaths redrawn on the official map (data/walkways-new/graph.json) into the routing
// graph and moves the 50 numbered places onto the new pins (position + entrance node):
//
//   python3 data/walkways-new/build_graph.py        # when the SVG or pins change
//   node scripts/import-redrawn-walkways.mjs [--dry-run]
//
// Re-runnable (upserts). The OSM research edges are only CLOSED, not deleted, so routing uses the
// redrawn graph alone; to go back:
//   UPDATE walk_edges SET status = 'open'   WHERE source_name LIKE 'openstreetmap%';
//   UPDATE walk_edges SET status = 'closed' WHERE source_name = 'redrawn_2026-10-10';
// (and restore place positions from data/pois/damsen-pois.json in git history).
import { readFileSync } from 'node:fs';
import { Console } from 'node:console';
import { URL } from 'node:url';

import pg from 'pg';

const logger = new Console({ stdout: process.stdout, stderr: process.stderr });
const dryRun = process.argv.includes('--dry-run');
const SOURCE = 'redrawn_2026-10-10';
const NODE_ID_BASE = 8_000_000_000n;
const EDGE_ID_BASE = 8_500_000_000n;
const read = (name) =>
  JSON.parse(
    readFileSync(new URL(`../data/walkways-new/${name}`, import.meta.url)),
  );
const graph = read('graph.json');
const places = read('damsen-pois-new.json').pois;

const pool = new pg.Pool({
  connectionString:
    process.env.DATABASE_URL ??
    'postgresql://damsen:damsen_local_only@127.0.0.1:64321/damsen',
  max: 1,
});
const client = await pool.connect();
try {
  await client.query('BEGIN');
  const closed = await client.query(
    `UPDATE walk_edges SET status = 'closed'
     WHERE source_name LIKE 'openstreetmap%' AND status <> 'closed'`,
  );
  for (const node of graph.nodes) {
    await client.query(
      `INSERT INTO walk_nodes (id, external_id, location, kind, source)
       VALUES ($1, $2, ST_SetSRID(ST_MakePoint($3, $4), 4326), $5, $6)
       ON CONFLICT (id) DO UPDATE SET location = EXCLUDED.location, kind = EXCLUDED.kind`,
      [
        (NODE_ID_BASE + BigInt(node.id)).toString(),
        node.externalId,
        node.lon,
        node.lat,
        node.kind,
        SOURCE,
      ],
    );
  }
  const edgeIds = [];
  for (const edge of graph.edges) {
    const id = (EDGE_ID_BASE + BigInt(edge.id)).toString();
    edgeIds.push(id);
    const line = `LINESTRING(${edge.coordinates.map(([x, y]) => `${x} ${y}`).join(',')})`;
    await client.query(
      `INSERT INTO walk_edges (id, external_id, source, target, geom, length_m, cost, reverse_cost,
                               accessibility, status, surface, source_name)
       VALUES ($1, $2, $3, $4, ST_GeomFromText($5, 4326), $6, $6, $6, 'standard', 'open', 'unknown', $7)
       ON CONFLICT (id) DO UPDATE SET source = EXCLUDED.source, target = EXCLUDED.target,
         geom = EXCLUDED.geom, length_m = EXCLUDED.length_m, cost = EXCLUDED.cost,
         reverse_cost = EXCLUDED.reverse_cost, status = 'open'`,
      [
        id,
        edge.externalId,
        (NODE_ID_BASE + BigInt(edge.source)).toString(),
        (NODE_ID_BASE + BigInt(edge.target)).toString(),
        line,
        edge.lengthM,
        SOURCE,
      ],
    );
  }
  await client.query(
    `UPDATE walk_edges SET status = 'closed'
     WHERE source_name = $1 AND NOT (id = ANY($2::bigint[]))`,
    [SOURCE, edgeIds],
  );

  let moved = 0;
  const missing = [];
  for (const place of places) {
    const prefix = `p${String(place.number).padStart(2, '0')}-%`;
    const poi = await client.query(
      'SELECT id FROM pois WHERE slug LIKE $1 LIMIT 1',
      [prefix],
    );
    if (!poi.rowCount) {
      missing.push(place.number);
      continue;
    }
    const poiId = poi.rows[0].id;
    await client.query(
      `UPDATE pois SET location = ST_SetSRID(ST_MakePoint($2, $3), 4326)::geography, updated_at = now()
       WHERE id = $1`,
      [poiId, place.longitude, place.latitude],
    );
    await client.query(
      `UPDATE poi_entrances SET location = ST_SetSRID(ST_MakePoint($2, $3), 4326)::geography,
         graph_node_ref = $4
       WHERE poi_id = $1 AND is_primary`,
      [
        poiId,
        place.entranceLongitude,
        place.entranceLatitude,
        place.entranceNode,
      ],
    );
    moved += 1;
  }
  logger.log(
    `${dryRun ? 'dry run: ' : ''}closed ${closed.rowCount} OSM edges; ${graph.nodes.length} nodes, ${graph.edges.length} edges (${SOURCE}); moved ${moved} places${missing.length ? `; not in DB: ${missing.join(', ')}` : ''}`,
  );
  await client.query(dryRun ? 'ROLLBACK' : 'COMMIT');
} catch (error) {
  await client.query('ROLLBACK');
  throw error;
} finally {
  client.release();
  await pool.end();
}
