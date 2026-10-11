/* global process, fetch */
// Appends the service notes of data/pois/poi-notes.json to the English long description of the
// places (ATM next to the Ferris wheel, bag storage, station services). Through the admin API:
// edit, submit, approve. A place whose description already has the note is left alone.
//
//   ADMIN_PASSWORD=... node scripts/import-poi-notes.mjs [--dry-run]
//   env: API_URL (default http://localhost:3000), ADMIN_EMAIL (default admin@damsen.local)
import { readFileSync } from 'node:fs';
import { URL } from 'node:url';
import { Console } from 'node:console';

const logger = new Console({ stdout: process.stdout, stderr: process.stderr });
const api = process.env.API_URL ?? 'http://localhost:3000';
const dryRun = process.argv.includes('--dry-run');
if (!process.env.ADMIN_PASSWORD) {
  logger.error('ADMIN_PASSWORD is required (the admin of the running API).');
  process.exit(1);
}
const { notes } = JSON.parse(
  readFileSync(new URL('../data/pois/poi-notes.json', import.meta.url), 'utf8'),
);

let token = '';
async function call(method, path, body) {
  const response = await fetch(`${api}${path}`, {
    method,
    headers: {
      'content-type': 'application/json',
      ...(token ? { authorization: `Bearer ${token}` } : {}),
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const text = await response.text();
  if (!response.ok) {
    throw new Error(
      `${method} ${path} → ${response.status} ${text.slice(0, 200)}`,
    );
  }
  return text ? JSON.parse(text) : null;
}

token = (
  await call('POST', '/v1/auth/login', {
    email: process.env.ADMIN_EMAIL ?? 'admin@damsen.local',
    password: process.env.ADMIN_PASSWORD,
  })
).accessToken;
const list = await call('GET', '/v1/admin/pois?limit=200');
const places = Array.isArray(list) ? list : list.items;
let changed = 0;
for (const [slug, note] of Object.entries(notes)) {
  const place = places.find((item) => item.slug === slug);
  if (!place) {
    logger.log(`skip ${slug}: no such place`);
    continue;
  }
  const english = place.translations.find((item) => item.locale === 'en');
  if (
    !note.en ||
    !english ||
    (english.longDescription ?? '').includes(note.en)
  ) {
    continue;
  }
  logger.log(`${dryRun ? 'would add' : 'add'} note to ${slug}`);
  changed += 1;
  if (dryRun) continue;
  const translations = place.translations.map((item) => ({
    locale: item.locale,
    name: item.name,
    shortDescription: item.shortDescription,
    longDescription:
      item.locale === 'en'
        ? `${(item.longDescription ?? '').trimEnd()} ${note.en}`.trim()
        : item.longDescription,
  }));
  await call('PATCH', `/v1/admin/pois/${place.id}`, { translations });
  const submitted = await call('POST', `/v1/admin/pois/${place.id}/submit`, {});
  await call(
    'POST',
    `/v1/admin/content/${submitted.pendingVersionId}/approve`,
    {},
  );
}
logger.log(`${changed} place(s) ${dryRun ? 'would change' : 'updated'}.`);
