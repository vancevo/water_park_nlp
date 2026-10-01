# Runbook — TTS worker foundation (backend)

Operate the provider-neutral TTS generation pipeline (C03 / AI02). Scope: the
worker foundation only — there is no real engine yet (Piper is AI03) and no admin
API/UI (AI04). See ADR 0008 and `docs/plans/AI_TTS_AND_TRAINING_ROADMAP.md`.

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
  `TTS_AUDIO_INVALID`, `TTS_PROVIDER_ERROR`, plus registry errors at request time.
- Cancel a non-terminal job with `TtsGenerationService.cancel(jobId)`; terminal
  jobs are returned unchanged.
- Re-running a dead-lettered job is deliberate, not automatic. The foundation
  returns a dead-lettered job as-is; a forced re-run belongs to the admin flow
  (AI04). As a stop-gap, an operator can delete the specific
  `tts_generation_jobs` row and request generation again.

## Migration 010

- Up: `npm run db:migrate` applies `010_tts_generation_jobs.up.sql`
  (unique idempotency key, `artifact` jsonb, artifact-state check, dead-letter
  index, FK to `poi_narrations` with `ON DELETE CASCADE`).
- Down: drops the table.

## Privacy and safety

- Never log or store the transcript, prompt, provider message or audio bytes; the
  job record keeps only hashes, a checksum and a stable error code.
- Every artifact records provider/model/version/license/checksum for provenance.
- No voice cloning without written consent and explicit rights (roadmap §3).
