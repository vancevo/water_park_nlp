/* global fetch */
// Imports the places in data/pois/damsen-pois.json through the admin API
// (create → submit → approve, so everything is audited), snapping each place's primary
// entrance to the nearest imported OSM path node.
//
//   npm run build --workspace @damsen/api && node scripts/import-osm-walkways.mjs   # once
//   ADMIN_PASSWORD=... node scripts/import-pois.mjs [--dry-run] [--no-publish]
//
// Re-running skips slugs that already exist. Positions are ESTIMATES read off the
// illustrated map (see the file's note): correct them on site with the /field screens.
import { readFileSync } from 'node:fs';
import { Console } from 'node:console';
import process from 'node:process';
import { URL } from 'node:url';

import pg from 'pg';

const logger = new Console({ stdout: process.stdout, stderr: process.stderr });
const args = new Set(process.argv.slice(2));
const dryRun = args.has('--dry-run');
const publish = !args.has('--no-publish');
const api = process.env.API_URL ?? 'http://localhost:3000';
const data = JSON.parse(
  readFileSync(
    new URL('../data/pois/damsen-pois.json', import.meta.url),
    'utf8',
  ),
);
const MAX_SNAP_METERS = 75;

const pool = new pg.Pool({
  connectionString:
    process.env.DATABASE_URL ??
    'postgresql://damsen:damsen_local_only@127.0.0.1:64321/damsen',
  max: 1,
});
let token = '';
async function call(method, path, body, expected) {
  const response = await fetch(`${api}${path}`, {
    method,
    headers: {
      'content-type': 'application/json',
      ...(token ? { authorization: `Bearer ${token}` } : {}),
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const text = await response.text();
  if (expected !== undefined && response.status !== expected)
    throw new Error(`${method} ${path} → ${response.status} ${text}`);
  return text ? JSON.parse(text) : null;
}

try {
  if (!dryRun) {
    const login = await call(
      'POST',
      '/v1/auth/login',
      {
        email: process.env.ADMIN_EMAIL ?? 'admin@damsen.local',
        password: process.env.ADMIN_PASSWORD,
      },
      200,
    );
    token = login.accessToken;
  }
  let created = 0;
  let skipped = 0;
  const far = [];
  for (const place of data.pois) {
    const exists = await pool.query('SELECT 1 FROM pois WHERE slug = $1', [
      place.slug,
    ]);
    if (exists.rowCount) {
      skipped += 1;
      continue;
    }
    const near = await pool.query(
      `SELECT external_id, ST_Y(location::geometry) AS lat, ST_X(location::geometry) AS lon,
              ST_Distance(location::geography, ST_SetSRID(ST_MakePoint($1, $2), 4326)::geography) AS metres
       FROM walk_nodes WHERE source LIKE 'openstreetmap%'
       ORDER BY location <-> ST_SetSRID(ST_MakePoint($1, $2), 4326) LIMIT 1`,
      [place.longitude, place.latitude],
    );
    const node = near.rows[0];
    if (!node)
      throw new Error(
        'no OSM path nodes: run scripts/import-osm-walkways.mjs first',
      );
    const metres = Math.round(node.metres);
    if (metres > MAX_SNAP_METERS)
      far.push(`#${place.number} ${place.nameVi} (${metres} m)`);
    if (dryRun) {
      logger.log(
        `would create #${place.number} ${place.slug} → ${node.external_id} (${metres} m)`,
      );
      continue;
    }
    const note = `Điểm số ${place.number} trên bản đồ công viên.`;
    const noteEn = `Place number ${place.number} on the park map.`;
    const poi = await call(
      'POST',
      '/v1/admin/pois',
      {
        slug: place.slug,
        category: place.category,
        location: { latitude: place.latitude, longitude: place.longitude },
        translations: [
          {
            locale: 'vi',
            name: place.nameVi,
            shortDescription: note,
            longDescription: note,
          },
          {
            locale: 'en',
            name: place.nameEn,
            shortDescription: noteEn,
            longDescription: noteEn,
          },
        ],
        entrances: [
          {
            labelVi: 'Lối vào',
            labelEn: 'Entrance',
            location: {
              latitude: Number(node.lat),
              longitude: Number(node.lon),
            },
            graphNodeRef: node.external_id,
            isPrimary: true,
            accessibility: 'standard',
          },
        ],
        operatingHours: [],
      },
      201,
    );
    if (publish) {
      const submitted = await call(
        'POST',
        `/v1/admin/pois/${poi.id}/submit`,
        {},
        200,
      );
      await call(
        'POST',
        `/v1/admin/content/${submitted.pendingVersionId}/approve`,
        {},
        200,
      );
    }
    created += 1;
  }
  logger.log(
    `${dryRun ? 'dry run' : 'done'}: ${created} created, ${skipped} skipped${publish ? ', published' : ', left as drafts'}`,
  );
  if (far.length) {
    logger.log(
      `entrance more than ${MAX_SNAP_METERS} m from the nearest path (check on site):`,
    );
    for (const line of far) logger.log(`  - ${line}`);
  }
} finally {
  await pool.end();
}
