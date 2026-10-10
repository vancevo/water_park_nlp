/* global fetch, setTimeout */
// Demo content: give every published POI an AI-voiced, human-approved
// narration (vi + en) so the visitor app has audio to play on first open.
// Uses only the public admin API — the same flow an editor follows in the
// admin UI: draft → "Tạo audio AI" (TTS job) → submit → approve.
// Skips a POI/locale that already has published audio.

const LOCALES = ['vi', 'en'];

async function call(api, token, method, path, body) {
  const res = await fetch(`${api}${path}`, {
    method,
    headers: {
      'content-type': 'application/json',
      ...(token ? { authorization: `Bearer ${token}` } : {}),
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const text = await res.text();
  if (!res.ok)
    throw new Error(`${method} ${path} → ${res.status} ${text.slice(0, 200)}`);
  return text ? JSON.parse(text) : null;
}

export async function seedNarrations({
  apiUrl,
  email,
  password,
  log,
  timeoutMs = 180_000,
}) {
  const { accessToken } = await call(apiUrl, null, 'POST', '/v1/auth/login', {
    email,
    password,
  });
  const pois = (await call(apiUrl, null, 'GET', '/v1/pois?locale=vi')).items;
  let created = 0;
  let skipped = 0;
  for (const poi of pois) {
    for (const locale of LOCALES) {
      let published = null;
      try {
        published = await call(
          apiUrl,
          null,
          'GET',
          `/v1/pois/${poi.id}/narration?locale=${locale}`,
        );
      } catch {
        published = null;
      }
      if (published?.audio) {
        skipped += 1;
        continue;
      }
      // Reuse the published text narration; otherwise read name + summary.
      const transcript =
        published?.transcript ?? `${poi.name}. ${poi.shortDescription}`;
      const draft = await call(
        apiUrl,
        accessToken,
        'POST',
        `/v1/admin/pois/${poi.id}/narrations`,
        { locale, transcript },
      );
      const queued = await call(
        apiUrl,
        accessToken,
        'POST',
        `/v1/admin/narrations/${draft.id}/tts-jobs`,
        { locale },
      );
      let job = queued;
      const deadline = Date.now() + timeoutMs;
      while (!['succeeded', 'failed', 'cancelled'].includes(job.status)) {
        if (Date.now() > deadline)
          throw new Error(`TTS job ${queued.id} quá thời gian`);
        await new Promise((r) => setTimeout(r, 1000));
        job = await call(
          apiUrl,
          accessToken,
          'GET',
          `/v1/admin/tts-jobs/${queued.id}`,
        );
      }
      if (job.status !== 'succeeded')
        throw new Error(
          `TTS ${poi.slug}/${locale}: ${job.status} ${job.errorCode ?? ''}`,
        );
      await call(
        apiUrl,
        accessToken,
        'POST',
        `/v1/admin/narrations/${draft.id}/submit`,
        {},
      );
      await call(
        apiUrl,
        accessToken,
        'POST',
        `/v1/admin/narrations/${draft.id}/approve`,
        {},
      );
      created += 1;
      log?.(`${poi.name} (${locale}) — audio AI đã tạo và duyệt`);
    }
  }
  return { created, skipped };
}
