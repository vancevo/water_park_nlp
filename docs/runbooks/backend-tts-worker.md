# Runbook — TTS worker foundation (backend)

Operate the provider-neutral TTS generation pipeline (C03 / AI02) and its queue
consumer (I02). See ADR 0008, ADR 0014 and
`docs/plans/AI_TTS_AND_TRAINING_ROADMAP.md`.

## Run the worker process (I02)

```bash
npm run build --workspace @damsen/worker
DATABASE_URL=… S3_ENDPOINT=… S3_BUCKET=… S3_ACCESS_KEY=… S3_SECRET_KEY=… \
TTS_WORKER_ENGINE=piper|cli TTS_VOICES_MANIFEST_PATH=<same file as the API> \
  npm run start --workspace @damsen/worker   # dev: npm run dev --workspace @damsen/worker
```

- Fails fast on bad config (missing DB/S3, `S3_ENABLED=false`, empty manifest).
- Loop: kill switch → quota `peek` → claim oldest queued row (`FOR UPDATE SKIP
  LOCKED`) → synthesize (retry/backoff/timeout) → upload WAV to
  `poi/{poi}/{locale}/{sha256}.wav` → one transaction: job `succeeded` +
  draft `audio_*` + `audio_generated_by` (only if still draft with the same
  transcript). Never publishes.
- Cancel wins at every checkpoint; SIGINT/SIGTERM stop claiming and drain.
- A `running` row older than `TTS_JOB_STALE_RUNNING_MS` (30 min) is re-claimed.
- Log lines carry job ids, statuses and codes only.
- Tuning: `TTS_WORKER_POLL_MS`, `TTS_JOB_TIMEOUT_MS`, `TTS_JOB_BACKOFF_MS`,
  `TTS_QUOTA_MAX_CONCURRENT`, `TTS_AUDIO_RIGHTS_OWNER`.

## Where it lives

- Domain: `apps/worker/src/tts/` (`TtsProvider` port, `TtsGenerationService`,
  `TtsModelRegistry`, audio validation, job repositories, hashing).
- Persistence: `tts_generation_jobs` table — `infra/migrations/010_*`.
- Exports: everything is re-exported from `apps/worker/src/main.ts`.

## Register a model/voice

Add a `TtsModelRegistryEntry` (today constructed in code; a config source can come
later):

```ts
{
  provider: 'piper',
  model: 'vi_VN-vais1000',
  modelVersion: '2026.01.0',      // immutable — never "main"/"latest"
  voiceId: 'vi_VN-vais1000-medium',
  locale: 'vi',                   // BCP 47; matches the narration locale catalog
  license: 'MIT',                 // license of THIS artifact; never inferred
  sourceUrl: 'https://huggingface.co/rhasspy/piper-voices/...',
  checksum: '<sha256 of the model artifact>',
  enabled: true,
}
```

The registry rejects a missing license/source/checksum, a mutable `modelVersion`
and duplicate entries. Disable a voice with `enabled: false` — it then serves no
new generation for that locale, but stored artifacts are unaffected.

## How generation behaves

- `generate({ narrationId, transcript, locale })` resolves the enabled voice for
  the locale, then runs the provider offline.
- Idempotent on `narrationId + transcriptHash + modelVersion`: a repeat request
  returns the existing job and never re-synthesizes.
- Retries transient failures with exponential backoff and a per-attempt timeout;
  after `maxAttempts` the job is terminal (`failed`, `deadLettered = true`).
- Output is a **draft artifact** only — generation never publishes and never
  changes an existing published narration.

## Operate

- Inspect dead-letter jobs:

  ```sql
  SELECT id, narration_id, status, error_code, attempts, updated_at
  FROM tts_generation_jobs
  WHERE dead_lettered
  ORDER BY updated_at DESC;
  ```

- Error codes are stable and safe to log/alert on: `TTS_TIMEOUT`,
  `TTS_AUDIO_INVALID`, `TTS_PROVIDER_ERROR`, `TTS_STORAGE_ERROR`,
  `TTS_MODEL_UNAVAILABLE`, `TTS_NARRATION_NOT_DRAFT`, `TTS_TRANSCRIPT_STALE`.
- Cancel a non-terminal job with `TtsGenerationService.cancel(jobId)`; terminal
  jobs are returned unchanged.
- Re-running a dead-lettered job is deliberate, not automatic: the editor
  presses generate again (the API re-queues the failed row in place).

## Migrations 010 / 012

- 012 (I02): `poi_narrations.audio_generated_by jsonb` + check + queued-job
  partial index. Down drops them (AI provenance is lost; audio stays).


- Up: `npm run db:migrate` applies `010_tts_generation_jobs.up.sql`
  (unique idempotency key, `artifact` jsonb, artifact-state check, dead-letter
  index, FK to `poi_narrations` with `ON DELETE CASCADE`).
- Down: drops the table.

## Privacy and safety

- Never log or store the transcript, prompt, provider message or audio bytes; the
  job record keeps only hashes, a checksum and a stable error code.
- Every artifact records provider/model/version/license/checksum for provenance.
- No voice cloning without written consent and explicit rights (roadmap §3).
