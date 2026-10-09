# I02 — Contract/integration fixes (Công, backend)

Input: the I02 list in `frontend-i01-integration-report.md` §4. Decisions and
contract v1.1: ADR 0014. Branch `cong/i02-i04`. Date: 2026-10-09.

## 1. Per-issue status

| ID | Issue | Status | Fix (where) | Test evidence |
|---|---|---|---|---|
| I02-1 | No queue consumer; `generate()` returned an API-queued row unchanged | **Fixed** | `TtsJobConsumer` + `TtsJobRunner` claim/run jobs (`apps/worker/src/tts/tts-job-runner.ts`), Postgres claim with `FOR UPDATE SKIP LOCKED` (`postgres-tts-job-queue.ts`), process entry `apps/worker/src/worker.ts` (`npm run start/dev --workspace @damsen/worker`) | `tts-job-runner.test.ts`; DB test "claims atomically: concurrent claimers get the job exactly once"; live smoke §3 |
| I02-2 | Cancel while `running` overwritten → `succeeded` | **Fixed** | Worker writes are conditional on `running`; commit transaction re-checks; API cancel/requeue are conditional UPDATEs (`postgres-tts-job.repository.ts`); `generate()` re-reads before saving | runner "cancel while synthesizing wins", "cancel during retry backoff"; DB "cancel while running wins"; API "cancel never overwrites a result"; live smoke job2 |
| I02-3 | Audio bytes dropped; not attached to draft; public job had no artifact/URL | **Fixed** | Worker uploads WAV (`tts-audio-store.ts`) and attaches `audio_*` + `audio_generated_by` to the **draft only** in one transaction; job exposes `artifact` summary; admin preview `GET /v1/admin/narrations/{id}/audio/playback` | runner "stores audio and attaches it to the draft with provenance"; DB "completes atomically"; `narration-ai-audio.service.test.ts`; live smoke job1 |
| I02-4 | AI08 kill switch and quota not wired | **Fixed** | API: `tts-job-controls.ts` (503 `AI_FEATURE_DISABLED`, 429 `rate_limited` / `concurrency_limited`); worker: consumer checks `TTS_GENERATION_ENABLED` per tick and `QuotaGuard` (`peek` added) before claiming | service tests (kill switch, rate window, backlog); consumer tests (disabled, throttled, slot release); live smoke §3 B/C |
| I02-5 | Create accepted non-draft narrations | **Fixed** | `409 NARRATION_NOT_DRAFT` (`tts-job.service.ts`) | service test over pending_review/published/rejected; HTTP test; live smoke |
| I02-6 | Submit not blocked while a job is queued/running | **Fixed** | `submit` and `PATCH` → `409 TTS_JOB_IN_PROGRESS` (`narration.service.ts`); create also allows one active job per narration | HTTP test "locks submit and edit while a job is queued"; live smoke job2 |
| I02-7 | OpenAPI lacked TTS error responses | **Fixed** | `apps/api/openapi.yaml` (400/401/403/404/409/429/503 + codes; 409 on submit/PATCH) | `tts-openapi-contract.test.ts` |
| I02-8 | `TTS_DEFAULT_*` missing from `.env.example`; fallback `'0'` → key mismatch | **Fixed** | `.env.example`; API reads the worker voice manifest (`TTS_VOICES_MANIFEST_PATH`) for per-locale stamps; boot warning on fallback; worker fails a mismatched job fast with `TTS_MODEL_UNAVAILABLE` | `tts-job-defaults.test.ts`; service "per-locale voices"; runner "fails fast with TTS_MODEL_UNAVAILABLE" |
| I02-9 | UUID v4 pipe rejected seeded narration ids | **Fixed** | Narration/job `:id` params accept any UUID version (`admin-tts-job.controller.ts`, `admin-narration.controller.ts`); POI ids stay v4 | HTTP test with an md5-style id |
| I02-10 | Running job showed a previous attempt's `errorCode` | **Fixed** | Claim clears `error_code`; runner/`generate()` keep retry codes in memory; API returns `errorCode` only for `failed` | runner + generation-service tests; DB claim test; live smoke asserts no `errorCode` while running |
| I02-11 | No admin playback URL, no AI provenance, no latest-job endpoint | **Fixed (additive v1.1)** | `audio/playback` endpoint, `AdminNarration.audioGeneratedBy`, `GET …/tts-jobs/latest`, job `artifact` | service/HTTP tests; live smoke |

Not changed (out of scope, noted): the public visitor narration does not yet
carry an "AI-generated" flag; worker metrics have no HTTP scrape endpoint
(ADR 0013 deferral); audit-log events for AI attach are not written.

## 2. New behaviour to know

- Job error codes (only on `failed`): `TTS_PROVIDER_ERROR`, `TTS_TIMEOUT`,
  `TTS_AUDIO_INVALID`, `TTS_STORAGE_ERROR`, `TTS_MODEL_UNAVAILABLE`,
  `TTS_NARRATION_NOT_DRAFT`, `TTS_TRANSCRIPT_STALE`.
- Request codes: 400 `NARRATION_LOCALE_DISABLED` / `TTS_JOB_LOCALE_MISMATCH` /
  `TTS_JOB_TRANSCRIPT_EMPTY` / `TTS_VOICE_UNAVAILABLE`; 409
  `NARRATION_NOT_DRAFT` / `TTS_JOB_IN_PROGRESS`; 429 `rate_limited` /
  `concurrency_limited` (`details.retryAfterSeconds`); 503 `AI_FEATURE_DISABLED`.
- Migration 012 must be applied before deploying this API (it selects
  `audio_generated_by`).

## 3. Live smoke (2026-10-09)

Stack: Postgres 16 isolated DB `damsen_i02` (migrations 001–012), API
`node apps/api/dist/main.js` on `:3100`, worker `node apps/worker/dist/worker.js`
(real process), object storage = **moto 5.1.4 S3 emulator** on `:3190`
(`pip install 'moto[server]'` in a scratch venv; see §4).
Provider = **CLI provider with a fake command** (`ffmpeg` 2 s sine tone, 3 s
delay, exits non-zero when the transcript contains `[fail]`) — **not a voice**.
Piper could not run: voice files on HuggingFace return 403 through the proxy.

| Step | Result |
|---|---|
| A. create → poll | `202 queued → running → succeeded`; job `artifact.audioSha256` present; `latest` returns it |
| A. draft audio | narration still `draft`; `audio` = `poi/{poi}/vi/{sha}.wav`, 88 278 B, 2 s, `audio/wav`; `audioGeneratedBy {provider e2e-tone, model ffmpeg-sine, modelVersion e2e-tone-2026.10.0, voiceId tone-vi, license, jobId}` |
| A. admin preview | `GET …/audio/playback` signed GET → bytes' sha256 = stored sha256, RIFF header |
| A. review gate | submit `200` (S3 HEAD verification) → create on `pending_review` `409 NARRATION_NOT_DRAFT` → approve `200` → public narration audio sha matches |
| A. submit lock | submit while queued → `409 TTS_JOB_IN_PROGRESS` |
| A. cancel while running | `queued → running → cancel 200 cancelled`; still `cancelled` 7 s later (worker log: "cancelled while running; result discarded"); draft audio `null`; retry re-queues the same id → `succeeded` |
| A. provider failure | `queued → running → failed`, `TTS_PROVIDER_ERROR`, 3 attempts, dead-lettered; no `errorCode` observed while running |
| B. worker kill switch | worker `TTS_GENERATION_ENABLED=false`: job stays `queued` 8 s; worker re-enabled → claimed → `succeeded` |
| B. API kill switch | API `TTS_GENERATION_ENABLED=false`: create → `503 AI_FEATURE_DISABLED` |
| C. quota | API `TTS_QUEUE_MAX_ACTIVE=1`: 2nd job → `429 concurrency_limited`; `TTS_QUOTA_MAX_PER_WINDOW=1`: next enqueue → `429 rate_limited {retryAfterSeconds: 60}` |
| Media smoke | `S3_ENDPOINT=http://127.0.0.1:3190 node scripts/smoke-media.mjs` → signed PUT, HEAD verification, signed GET pass |

Emulator caveat: a probe showed moto accepts a presigned PUT with a tampered
body or a zeroed signature (no SigV4 / `x-amz-checksum-sha256` enforcement).
The smoke proves protocol wiring, keys, metadata and the end-to-end flow, not
storage-side integrity enforcement. **B03 stays open for real MinIO/S3** (I04).

## 4. Reproduce

```bash
export PATH=/opt/node24/bin:$PATH
# Disposable DB (never the shared one for destructive runs)
PGPASSWORD=… psql -h 127.0.0.1 -p 64321 -U damsen -d damsen -c 'CREATE DATABASE damsen_i02'
psql … -d damsen_i02 -f infra/docker/init-postgres.sql
DATABASE_URL=…/damsen_i02 npm run db:migrate

# Dev-only S3 emulator when MinIO is unavailable (never for production)
python3 -m venv /tmp/moto && /tmp/moto/bin/pip install 'moto[server]==5.1.4'
/tmp/moto/bin/moto_server -H 127.0.0.1 -p 3190 &

npm run build
# API + worker share TTS_VOICES_MANIFEST_PATH (CLI or Piper manifest)
export DATABASE_URL=…/damsen_i02 S3_ENDPOINT=http://127.0.0.1:3190 \
  TTS_VOICES_MANIFEST_PATH=<manifest> TTS_WORKER_ENGINE=cli …
PORT=3100 node apps/api/dist/main.js &
node apps/worker/dist/worker.js &
TTS_QUEUE_TEST_DATABASE_URL=…/damsen_i02 npx vitest run --root apps/worker test/postgres-tts-job-queue.int.test.ts
```

## 5. Follow-ups for Tú's UI (optional, no UI change is required)

- Use `artifact` on a succeeded job and `GET …/audio/playback` to let the editor
  listen to the AI draft; `audioGeneratedBy` for the AI-generated label.
- `GET …/tts-jobs/latest` to resume a job after a page reload.
- Map the new codes: `NARRATION_NOT_DRAFT`, `TTS_JOB_IN_PROGRESS`,
  `TTS_VOICE_UNAVAILABLE`, and job codes `TTS_STORAGE_ERROR`,
  `TTS_MODEL_UNAVAILABLE`, `TTS_NARRATION_NOT_DRAFT`, `TTS_TRANSCRIPT_STALE`
  (today they fall back to the generic 409/400/failed copy).
- The "succeeded" panel can again say the audio is attached to the draft (true
  now). Re-run I03 before switching `NEXT_PUBLIC_TTS_GENERATION_MODE` to `api`.
