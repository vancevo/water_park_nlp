/* global process, fetch, setTimeout */
// Gives every published place an AI-voiced narration audio in Vietnamese and English (Piper), the
// same flow as the admin "Tạo audio AI": draft with the published text → TTS job → submit →
// approve. A place/language that already has published audio is skipped, so it is safe to repeat.
//
// Needs the TTS worker running with Piper (see docs/runbooks/backend-tts-worker.md and
// backend-tts-piper.md) and the voices of config/tts-voices.json. `node scripts/demo/demo.mjs
// start` starts all of that and calls the same flow.
//
//   ADMIN_PASSWORD=... node scripts/generate-narration-audio.mjs [--only slug,slug]
//   env: API_URL (default http://localhost:3000), ADMIN_EMAIL (default admin@damsen.local)
import { readFileSync } from 'node:fs';
import { URL } from 'node:url';
import { Console } from 'node:console';

const logger = new Console({ stdout: process.stdout, stderr: process.stderr });
const api = process.env.API_URL ?? 'http://localhost:3000';
const only = process.argv.includes('--only')
  ? new Set(process.argv[process.argv.indexOf('--only') + 1].split(','))
  : null;
if (!process.env.ADMIN_PASSWORD) {
  logger.error('ADMIN_PASSWORD is required (the admin of the running API).');
  process.exit(1);
}
const manifest = JSON.parse(
  readFileSync(new URL('../config/tts-voices.json', import.meta.url), 'utf8'),
);
// The voice of each language, named in the job so the API need not know the manifest.
const voices = Object.fromEntries(
  manifest.voices
    .filter((voice) => voice.enabled)
    .map((voice) => [voice.locale, voice]),
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
    throw Object.assign(
      new Error(`${method} ${path} → ${response.status} ${text.slice(0, 200)}`),
      { status: response.status },
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
const places = (await call('GET', '/v1/pois?locale=vi')).items.filter(
  (place) => !only || only.has(place.slug),
);
let created = 0;
let skipped = 0;
for (const place of places) {
  for (const locale of ['vi', 'en']) {
    const voice = voices[locale];
    if (!voice) continue;
    let published = null;
    try {
      published = await call(
        'GET',
        `/v1/pois/${place.id}/narration?locale=${locale}`,
      );
    } catch {
      published = null;
    }
    if (published?.audio && published.resolvedLocale === locale) {
      skipped += 1;
      continue;
    }
    const transcript =
      published?.resolvedLocale === locale
        ? published.transcript
        : `${place.name}. ${place.shortDescription}`;
    let draft;
    try {
      draft = await call('POST', `/v1/admin/pois/${place.id}/narrations`, {
        locale,
        transcript,
      });
    } catch (error) {
      if (error.status !== 409) throw error;
      // A draft left by an earlier run: reuse it.
      const drafts = await call('GET', `/v1/admin/pois/${place.id}/narrations`);
      draft = (Array.isArray(drafts) ? drafts : drafts.items).find(
        (item) => item.locale === locale && item.status === 'draft',
      );
      if (!draft) throw error;
    }
    let job = await call('POST', `/v1/admin/narrations/${draft.id}/tts-jobs`, {
      locale,
      provider: voice.provider,
      model: voice.model,
    });
    const jobId = job.id;
    for (
      let waited = 0;
      !['succeeded', 'failed', 'cancelled'].includes(job.status);
      waited += 1
    ) {
      if (waited > 240) throw new Error(`TTS job ${jobId} timed out`);
      await new Promise((resolve) => setTimeout(resolve, 1000));
      job = await call('GET', `/v1/admin/tts-jobs/${jobId}`);
    }
    if (job.status !== 'succeeded') {
      throw new Error(
        `${place.slug}/${locale}: ${job.status} ${job.errorCode ?? ''}`,
      );
    }
    await call('POST', `/v1/admin/narrations/${draft.id}/submit`, {});
    await call('POST', `/v1/admin/narrations/${draft.id}/approve`, {});
    created += 1;
    logger.log(`${place.name} (${locale}): audio created and approved`);
  }
}
logger.log(`${created} audio file(s) created, ${skipped} already there.`);
