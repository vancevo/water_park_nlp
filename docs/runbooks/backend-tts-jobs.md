# Runbook — Admin TTS job API (backend)

Operate the admin endpoints that queue, poll and cancel TTS generation jobs
(AI04). Scope: the API surface only — synthesis, retry and dead-letter are the
worker (C03/AI02, Piper C04/AI03). See ADR 0010, ADR 0008 and
`docs/plans/AI_TTS_AND_TRAINING_ROADMAP.md`.

## Where it lives

- Endpoints: `apps/api/src/narration/admin-tts-job.controller.ts`
  - `POST /v1/admin/narrations/{narrationId}/tts-jobs` → `202` queued job
  - `GET  /v1/admin/tts-jobs/{jobId}` → `200` current job
  - `POST /v1/admin/tts-jobs/{jobId}/cancel` → `200` job after cancel
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
| Poll | EDITOR, REVIEWER, ADMIN |
| Cancel | EDITOR, ADMIN |

Visitors → `403`; missing/invalid bearer token → `401`.

## Configuration

Enqueue metadata defaults (override per deployment so they match the worker's
configured provider):

```
TTS_DEFAULT_PROVIDER=piper
TTS_DEFAULT_MODEL=piper
TTS_DEFAULT_MODEL_VERSION=<pinned version, e.g. 2026.01.0>
TTS_JOB_MAX_ATTEMPTS=3
```

With no `DATABASE_URL` the API uses the in-memory job store (dev/tests); with one
it writes the shared Postgres table.

## Behaviour notes

- **Draft only.** A job never publishes or approves a narration. The worker writes
  a draft artifact; approval stays in the narration workflow (`.../approve`).
- **Idempotent.** Re-creating for the same narration + transcript + model version
  returns the existing queued/running/succeeded job; a failed or cancelled job is
  re-queued in place.
- **Validation errors:** `NARRATION_LOCALE_DISABLED` (locale not enabled),
  `TTS_JOB_LOCALE_MISMATCH` (locale ≠ narration locale), `TTS_JOB_TRANSCRIPT_EMPTY`
  (all `400`); unknown narration or job → `404`.
- **Privacy.** Job rows store only the transcript hash and a stable error code.

## Troubleshooting

- `202` but the job never leaves `queued`: the worker is not consuming the table
  yet — worker claiming is finalized in integration/AI05 (ADR 0010 boundary).
- `400 TTS_JOB_LOCALE_MISMATCH`: request a job in the narration's own locale; one
  narration = one locale.
- Duplicate-looking requests return the same job id — expected (idempotency).
