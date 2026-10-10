/* global fetch */
// Dev helper: create a few SAMPLE places through the admin API (create → submit →
// approve), with the entrance snapped to the nearest imported OSM path node, so the
// visitor map, search and routing have something real-looking to show.
//
//   ADMIN_PASSWORD=... node scripts/seed-sample-pois.mjs   (run import-osm-walkways first)
//
// Positions are read off the illustrated map and are APPROXIMATE (not surveyed);
// descriptions say so. Re-running skips places whose slug already exists.
import { Console } from 'node:console';
import process from 'node:process';

import pg from 'pg';

const logger = new Console({ stdout: process.stdout, stderr: process.stderr });
const api = process.env.API_URL ?? 'http://localhost:3000';
const NOTE_VI = 'Dữ liệu thử nghiệm, vị trí ước lượng từ bản đồ minh họa.';
const NOTE_EN = 'Sample data; position estimated from the illustrated map.';
const SAMPLES = [
  {
    slug: 'nhac-nuoc-ho-dam-sen',
    category: 'show',
    location: { latitude: 10.766673, longitude: 106.638302 },
    vi: [
      'Biểu diễn nhạc nước',
      'Đài phun nước trên hồ Đầm Sen, biểu diễn theo nhạc.',
    ],
    en: [
      'Water Music Fountain',
      'A fountain on Dam Sen Lake that performs to music.',
    ],
  },
  {
    slug: 'san-khau-ngoi-sao',
    category: 'show',
    location: { latitude: 10.765831, longitude: 106.638053 },
    vi: [
      'Sân khấu Ngôi Sao',
      'Sân khấu nằm trên đảo giữa hồ, nối với bờ bằng cầu.',
    ],
    en: [
      'Star Stage',
      'A stage on the island in the middle of the lake, reached by a bridge.',
    ],
  },
  {
    slug: 'du-quay-dung',
    category: 'landmark',
    location: { latitude: 10.76798, longitude: 106.638092 },
    vi: [
      'Đu quay đứng',
      'Vòng đu quay cao ở phía bắc hồ, nhìn thấy từ xa trong công viên.',
    ],
    en: [
      'Ferris Wheel',
      'A tall Ferris wheel north of the lake, visible from much of the park.',
    ],
  },
];

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
  for (const sample of SAMPLES) {
    const exists = await pool.query('SELECT 1 FROM pois WHERE slug = $1', [
      sample.slug,
    ]);
    if (exists.rowCount) {
      logger.log(`skip ${sample.slug} (exists)`);
      continue;
    }
    const near = await pool.query(
      `SELECT external_id, ST_Y(location::geometry) AS lat, ST_X(location::geometry) AS lon,
              ST_Distance(location::geography, ST_SetSRID(ST_MakePoint($1, $2), 4326)::geography) AS metres
       FROM walk_nodes WHERE source LIKE 'openstreetmap%'
       ORDER BY location <-> ST_SetSRID(ST_MakePoint($1, $2), 4326) LIMIT 1`,
      [sample.location.longitude, sample.location.latitude],
    );
    const node = near.rows[0];
    if (!node)
      throw new Error('no OSM path nodes: run scripts/import-osm-walkways.mjs');
    const created = await call(
      'POST',
      '/v1/admin/pois',
      {
        slug: sample.slug,
        category: sample.category,
        location: sample.location,
        translations: [
          {
            locale: 'vi',
            name: sample.vi[0],
            shortDescription: sample.vi[1],
            longDescription: `${sample.vi[1]} ${NOTE_VI}`,
          },
          {
            locale: 'en',
            name: sample.en[0],
            shortDescription: sample.en[1],
            longDescription: `${sample.en[1]} ${NOTE_EN}`,
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
    const submitted = await call(
      'POST',
      `/v1/admin/pois/${created.id}/submit`,
      {},
      200,
    );
    const versionId = submitted.pendingVersionId;
    if (!versionId)
      throw new Error(
        `no pendingVersionId in ${JSON.stringify(Object.keys(submitted))}`,
      );
    await call('POST', `/v1/admin/content/${versionId}/approve`, {}, 200);
    logger.log(
      `published ${sample.slug} (entrance ${node.external_id}, ${Math.round(node.metres)} m from the drawn spot)`,
    );
  }
} finally {
  await pool.end();
}
