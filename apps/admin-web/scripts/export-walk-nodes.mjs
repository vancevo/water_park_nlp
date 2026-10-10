// Writes public/data/osm-walk-nodes.json: the OSM path nodes the routing graph is
// built from (scripts/import-osm-walkways.mjs), so the POI form can snap an
// entrance to the nearest path node without an API call.
//
//   npm run build --workspace @damsen/api && node apps/admin-web/scripts/export-walk-nodes.mjs
import { writeFileSync } from 'node:fs';
import process from 'node:process';
import { fileURLToPath, URL } from 'node:url';

import {
  DAMSEN_OSM_WALK_NODES,
  DAMSEN_OSM_WALK_WAYS,
} from '../../api/dist/routing/damsen-osm-network.js';

const used = new Set(DAMSEN_OSM_WALK_WAYS.flatMap((way) => way.nodeIds));
const nodes = DAMSEN_OSM_WALK_NODES.filter((node) => used.has(node.id)).map(
  (node) => ({
    ref: `osm-${node.id}`,
    lon: Number(node.longitude.toFixed(7)),
    lat: Number(node.latitude.toFixed(7)),
  }),
);
writeFileSync(
  fileURLToPath(new URL('../public/data/osm-walk-nodes.json', import.meta.url)),
  `${JSON.stringify(nodes)}\n`,
);
process.stdout.write(`wrote ${nodes.length} nodes\n`);
