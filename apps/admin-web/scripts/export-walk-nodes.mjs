// Writes public/data/osm-walk-nodes.json: the path nodes of the routing graph
// (data/walkways-new/graph.json, built by build_graph.py and loaded by
// scripts/import-redrawn-walkways.mjs), so the POI form can snap an entrance to
// the nearest path node without an API call.
//
//   python3 data/walkways-new/build_graph.py && node apps/admin-web/scripts/export-walk-nodes.mjs
import { readFileSync, writeFileSync } from 'node:fs';
import process from 'node:process';
import { fileURLToPath, URL } from 'node:url';

const graph = JSON.parse(
  readFileSync(
    fileURLToPath(
      new URL('../../../data/walkways-new/graph.json', import.meta.url),
    ),
    'utf8',
  ),
);
const nodes = graph.nodes.map((node) => ({
  ref: node.externalId,
  lon: node.lon,
  lat: node.lat,
}));
writeFileSync(
  fileURLToPath(new URL('../public/data/osm-walk-nodes.json', import.meta.url)),
  `${JSON.stringify(nodes)}\n`,
);
process.stdout.write(`wrote ${nodes.length} nodes\n`);
