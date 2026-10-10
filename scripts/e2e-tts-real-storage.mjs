/* global process, console, fetch */
// L1/L2 end-to-end: real API + worker (real Piper voice) + real S3-compatible
// storage. Needs the stack from docs/runbooks/backend-i04-release-gate.md.
//
//   API_URL=http://localhost:3000 ADMIN_EMAIL=admin@damsen.local \
//   ADMIN_PASSWORD=... node scripts/e2e-tts-real-storage.mjs [vi|en]
//
// Flow: login → draft narration → TTS job → poll → draft audio (signed GET,
// sha256 + RIFF) → submit → approve → public narration with audio.generatedBy
// → public audio bytes. Then storage integrity: a presigned PUT with a tampered
// body and one with a wrong checksum header must be refused, and a browser
// CORS preflight from the admin origin must be allowed (other origins not).
//
// The draft audio may be WAV (default) or the worker's release encoding
// (TTS_AUDIO_RELEASE_FORMAT=mp3|m4a, C04); its container is checked against
// the stored MIME type. E2E_SKIP_STORAGE_INTEGRITY=1 skips the storage
// integrity/CORS probes on an S3 EMULATOR (moto does not enforce them) — never
// on MinIO/S3, where they are part of the release gate.
import assert from 'node:assert/strict';
import { Buffer } from 'node:buffer';
import { createHash, randomUUID } from 'node:crypto';
import { setTimeout as sleep } from 'node:timers/promises';

const api = process.env.API_URL ?? 'http://localhost:3000';
const locale = process.argv[2] ?? 'vi';
const adminOrigin = process.env.ADMIN_ORIGIN ?? 'http://localhost:3001';
const TRANSCRIPTS = {
  vi: 'Chào mừng bạn đến Công viên nước Đầm Sen. Hãy đi chậm và quan sát biển chỉ dẫn.',
  en: 'Welcome to Dam Sen Water Park. Please walk slowly and follow the signs.',
  fr: 'Bienvenue au parc aquatique de Dam Sen. Marchez doucement et suivez les panneaux.',
};
const sha256 = (bytes) => createHash('sha256').update(bytes).digest('hex');

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
  const json = text ? JSON.parse(text) : null;
  if (expected !== undefined) {
    assert.equal(response.status, expected, `${method} ${path}: ${text}`);
  } else {
    assert.ok(response.ok, `${method} ${path} → ${response.status} ${text}`);
  }
  return json;
}
const step = (message) => console.log(`✓ ${message}`);

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
step('admin login');

const pois = await call('GET', '/v1/pois');
const poiId = pois.items[0].id;
const created = await call(
  'POST',
  `/v1/admin/pois/${poiId}/narrations`,
  { locale, transcript: TRANSCRIPTS[locale] },
  201,
);
step(`draft narration ${created.id} (${locale})`);

const queued = await call(
  'POST',
  `/v1/admin/narrations/${created.id}/tts-jobs`,
  { locale },
  202,
);
let job = queued;
const deadline = Date.now() + 120_000;
const seen = new Set([job.status]);
while (!['succeeded', 'failed', 'cancelled'].includes(job.status)) {
  assert.ok(Date.now() < deadline, `job stuck in ${job.status}`);
  await sleep(1000);
  job = await call('GET', `/v1/admin/tts-jobs/${queued.id}`);
  seen.add(job.status);
}
assert.equal(job.status, 'succeeded', JSON.stringify(job));
step(`job ${[...seen].join(' → ')}`);

const draft = await call('GET', `/v1/admin/pois/${poiId}/narrations`);
const draftNarration = draft.find((item) => item.id === created.id);
assert.ok(draftNarration.audio, 'draft has audio');
assert.equal(draftNarration.status, 'draft', 'AI audio stays a draft');
assert.ok(draftNarration.audioGeneratedBy, 'draft carries AI provenance');
const playback = await call(
  'GET',
  `/v1/admin/narrations/${created.id}/audio/playback`,
);
const draftBytes = Buffer.from(
  await (await fetch(playback.playbackUrl)).arrayBuffer(),
);
const magic = {
  'audio/wav': (b) => b.subarray(0, 4).toString('latin1') === 'RIFF',
  'audio/mpeg': (b) =>
    b.subarray(0, 3).toString('latin1') === 'ID3' ||
    (b[0] === 0xff && (b[1] & 0xe0) === 0xe0),
  'audio/mp4': (b) => b.subarray(4, 8).toString('latin1') === 'ftyp',
};
const mime = draftNarration.audio.mimeType;
assert.ok(magic[mime]?.(draftBytes), `draft audio is not a valid ${mime}`);
assert.equal(sha256(draftBytes), draftNarration.audio.sha256);
step(
  `draft audio ${mime} ${draftBytes.length} B, ${draftNarration.audio.durationSeconds}s by ${draftNarration.audioGeneratedBy.provider}/${draftNarration.audioGeneratedBy.voiceId}`,
);

await call('POST', `/v1/admin/narrations/${created.id}/submit`, {}, 200);
await call('POST', `/v1/admin/narrations/${created.id}/approve`, {}, 200);
step('submit → approve (human review gate)');

const pub = await call('GET', `/v1/pois/${poiId}/narration?locale=${locale}`);
assert.equal(pub.resolvedLocale, locale);
assert.ok(pub.audio?.generatedBy, 'public audio exposes generatedBy');
assert.equal(
  'jobId' in pub.audio.generatedBy,
  false,
  'no internal job id in public provenance',
);
const pubBytes = Buffer.from(
  await (await fetch(pub.audio.playbackUrl)).arrayBuffer(),
);
assert.equal(sha256(pubBytes), pub.audio.sha256);
step('public narration serves the same bytes with generatedBy');

if (process.env.E2E_SKIP_STORAGE_INTEGRITY === '1') {
  console.log(`PASS e2e-tts-real-storage (${locale}; storage probes skipped)`);
  process.exit(0);
}

// Storage-side integrity on the real S3 endpoint.
const good = Buffer.from(`integrity probe ${randomUUID()}`);
const intent = await call('POST', '/v1/admin/media/presign', {
  poiId,
  locale,
  mimeType: 'audio/wav',
  sizeBytes: good.length,
  sha256: sha256(good),
});
const put = (body, headers) =>
  fetch(intent.uploadUrl, { method: 'PUT', headers, body });
const tampered = Buffer.from(good);
tampered[0] ^= 0xff;
const tamperedResult = await put(tampered, intent.requiredHeaders);
assert.ok(
  !tamperedResult.ok,
  `tampered body accepted (${tamperedResult.status})`,
);
const wrongHeader = await put(good, {
  ...intent.requiredHeaders,
  'x-amz-checksum-sha256': Buffer.alloc(32).toString('base64'),
});
assert.ok(!wrongHeader.ok, `wrong checksum accepted (${wrongHeader.status})`);
const ok = await put(good, intent.requiredHeaders);
assert.ok(ok.ok, `valid upload refused (${ok.status})`);
step(
  `PUT: tampered ${tamperedResult.status}, wrong checksum ${wrongHeader.status}, valid ${ok.status}`,
);

const preflight = (origin) =>
  fetch(intent.uploadUrl, {
    method: 'OPTIONS',
    headers: {
      origin,
      'access-control-request-method': 'PUT',
      'access-control-request-headers':
        'content-type,x-amz-checksum-sha256,x-amz-meta-sha256',
    },
  });
const allowed = await preflight(adminOrigin);
assert.equal(allowed.headers.get('access-control-allow-origin'), adminOrigin);
const denied = await preflight('http://evil.example');
assert.equal(denied.headers.get('access-control-allow-origin'), null);
step('CORS preflight: admin origin allowed, foreign origin refused');

console.log(`PASS e2e-tts-real-storage (${locale})`);
