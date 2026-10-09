# Runbook — Admin TTS job API (backend)

Operate the admin endpoints that queue, poll and cancel TTS generation jobs
(AI04, hardened in I02). Scope: the API surface — synthesis, retry,
dead-letter and the draft-audio attach are the worker's queue consumer
(`backend-tts-worker.md`). See ADR 0010, ADR 0014 (contract v1.1), ADR 0008.

## Where it lives

- Endpoints: `apps/api/src/narration/admin-tts-job.controller.ts`
  - `POST /v1/admin/narrations/{narrationId}/tts-jobs` → `202` queued job
  - `GET  /v1/admin/tts-jobs/{jobId}` → `200` current job
  - `POST /v1/admin/tts-jobs/{jobId}/cancel` → `200` job after cancel
  - v1.1: `GET /v1/admin/narrations/{narrationId}/tts-jobs/latest` →
    `{ job | null }`; `GET /v1/admin/narrations/{id}/audio/playback` → signed
    preview URL of the narration's current (draft) audio
- Orchestration: `apps/api/src/narration/tts-job.service.ts` (`AdminTtsJobService`).
- Persistence: `apps/api/src/narration/{in-memory,postgres}-tts-job.repository.ts`
  → shared `tts_generation_jobs` table (`infra/migrations/010_*`, owned by the
  worker foundation).
- Contract: `apps/api/openapi.yaml`; client methods `createTtsJob`, `getTtsJob`,
  `cancelTtsJob` in `packages/api-client`.

## Roles

| Action | Allowed roles |
|---|---|
| Create (enqueue) | EDITOR, ADMIN |
| Poll, latest job, audio preview | EDITOR, REVIEWER, ADMIN |
| Cancel | EDITOR, ADMIN |

Visitors → `403`; missing/invalid bearer token → `401`.

## Configuration

All keys are listed in `.env.example`.

- **Voice stamp (must match the worker):** set `TTS_VOICES_MANIFEST_PATH` to
  the same manifest the worker loads; the API stamps the per-locale
  `provider/model/modelVersion` from it and rejects a locale without an enabled
  voice (`400 TTS_VOICE_UNAVAILABLE`). Without a manifest, `TTS_DEFAULT_PROVIDER`
  / `TTS_DEFAULT_MODEL` / `TTS_DEFAULT_MODEL_VERSION` apply to every locale; if
  none is set the API logs a warning and jobs fail with `TTS_MODEL_UNAVAILABLE`.
- `TTS_JOB_MAX_ATTEMPTS=3`.
- AI08: `TTS_GENERATION_ENABLED` (kill switch), `TTS_QUOTA_WINDOW_MS`,
  `TTS_QUOTA_MAX_PER_WINDOW` (per user, per API process), `TTS_QUEUE_MAX_ACTIVE`
  (queued+running backlog). Env is read at boot: change it and restart the
  process (no rebuild).

With no `DATABASE_URL` the API uses the in-memory job store (dev/tests); with one
it writes the shared Postgres table (migration 010 + 012).

## Behaviour notes

- **Draft only.** Only a `draft` narration accepts a job (`409
  NARRATION_NOT_DRAFT`). The worker attaches the audio + `audioGeneratedBy` to
  that draft; approval stays in the narration workflow (`.../approve`).
- **Review gate.** While a job is queued/running, submit and PATCH of the
  narration return `409 TTS_JOB_IN_PROGRESS`; one active job per narration.
- **Idempotent.** Re-creating for the same narration + transcript + model version
  returns the existing queued/running job, or the succeeded job while the draft
  still carries its audio; a failed or cancelled job — or a succeeded one whose
  audio was since replaced — is re-queued in place (same id). Replays do not
  consume quota.
- **Cancel** is a conditional write: it never overwrites a result the worker
  already committed; a running job's result is discarded.
- **Errors:** 400 `NARRATION_LOCALE_DISABLED`, `TTS_JOB_LOCALE_MISMATCH`,
  `TTS_JOB_TRANSCRIPT_EMPTY`, `TTS_VOICE_UNAVAILABLE`; 404 unknown narration/job;
  409 above; 429 `rate_limited` / `concurrency_limited`; 503
  `AI_FEATURE_DISABLED`. `errorCode` on a job appears only when `failed`.
- **Privacy.** Job rows store only the transcript hash and a stable error code.

## Troubleshooting

- `202` but the job never leaves `queued`: the worker process is not running,
  `TTS_GENERATION_ENABLED=false` on the worker, or its quota is saturated —
  check the worker log (`tts consumer: …`).
- Job `failed` with `TTS_MODEL_UNAVAILABLE`: the API stamp does not match a
  worker voice — point both at the same `TTS_VOICES_MANIFEST_PATH`, then retry.
- `TTS_TRANSCRIPT_STALE` / `TTS_NARRATION_NOT_DRAFT`: the narration changed
  after enqueue; generate again from the current draft.
- `400 TTS_JOB_LOCALE_MISMATCH`: request a job in the narration's own locale; one
  narration = one locale.
- Duplicate-looking requests return the same job id — expected (idempotency).
