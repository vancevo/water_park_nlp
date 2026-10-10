/* global process, fetch, crypto */
// Marks the places as "checked" on /field (an "Đúng vị trí" field check at the place's own
// position), except the test spot, which stays unchecked so /field keeps one place to try the
// measuring screen on. This is bookkeeping, NOT a GPS measurement: every check carries a note
// saying so, and no position is changed.
//
//   ADMIN_PASSWORD=... node scripts/field-mark-checked.mjs [--dry-run]
//   env: API_URL (default http://localhost:3000), ADMIN_EMAIL (default admin@damsen.local)
//
// Safe to repeat: a place that already has any field check is skipped.
import { Console } from 'node:console';

const logger = new Console({ stdout: process.stdout, stderr: process.stderr });
const api = process.env.API_URL ?? 'http://localhost:3000';
const dryRun = process.argv.includes('--dry-run');
/** Places that stay unchecked (the experimental spot used to try the /field measuring screen). */
const KEEP_UNCHECKED = new Set(['new-diem-thu']);
const NOTE =
  'Đánh dấu đã kiểm theo yêu cầu của chủ dự án — không đo GPS tại hiện trường, vị trí giữ nguyên.';

if (!process.env.ADMIN_PASSWORD) {
  logger.error('ADMIN_PASSWORD is required (the admin of the running API).');
  process.exit(1);
}

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
  if (response.status !== expected) {
    throw new Error(`${method} ${path} → ${response.status} ${text.slice(0, 200)}`);
  }
  return text ? JSON.parse(text) : null;
}

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
const pois = await call('GET', '/v1/admin/pois', undefined, 200);
const checks = await call('GET', '/v1/admin/field-checks', undefined, 200);
const checked = new Set(checks.map((check) => check.poiId));

let marked = 0;
let skipped = 0;
for (const poi of pois) {
  if (KEEP_UNCHECKED.has(poi.slug) || checked.has(poi.id)) {
    skipped += 1;
    continue;
  }
  marked += 1;
  if (dryRun) continue;
  await call(
    'POST',
    `/v1/admin/pois/${poi.id}/field-checks`,
    {
      clientId: crypto.randomUUID(),
      target: 'poi',
      location: {
        latitude: poi.location.latitude,
        longitude: poi.location.longitude,
      },
      accuracyMeters: 5,
      sampleCount: 1,
      outcome: 'confirmed',
      note: NOTE,
    },
    201,
  );
}
logger.log(
  `${dryRun ? 'dry run: ' : ''}${marked} places marked as checked, ${skipped} left as they were`,
);
