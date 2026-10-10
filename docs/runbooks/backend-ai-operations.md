# Runbook — AI/TTS operations (backend hardening)

Operate the AI/TTS pipeline safely: metrics, quotas, retention, rollback and
incident drills (AI08 / C07). Scope: operational controls over the existing
pipeline (no new AI capability). See ADR 0013, ADR 0008–0011 and
`docs/plans/AI_TTS_AND_TRAINING_ROADMAP.md` (AI08).

## Where it lives

- Ops modules: `apps/worker/src/ops/` — `metrics.ts`, `tts-metrics.ts`,
  `quota.ts`, `retention.ts`, `ai-feature-flags.ts` (all re-exported from
  `apps/worker/src/main.ts`).
- Alerts/dashboards: `infra/observability/` (`tts-alerts.yaml`, README).
- Retention index: `infra/migrations/011_tts_retention_index.*`.

## Metrics

`TtsMetrics` records `tts_jobs_total`, `tts_job_retries_total`,
`tts_job_dead_letters_total`, `tts_generation_duration_ms`, `tts_queue_depth`
(labels: status/provider/model/model_version/error_code only). The worker
serves them at `GET /metrics` (Prometheus text) and `GET /healthz` on
`WORKER_METRICS_HOST:WORKER_METRICS_PORT` (default `127.0.0.1:9464`); scrape
config in `infra/observability/README.md`. **Never** log or label a transcript,
prompt, query or raw GPS.

## Kill switches / rollback

- **Disable TTS generation:** `TTS_GENERATION_ENABLED=false` (default on) on
  BOTH processes, then restart them (env is read at boot; no rebuild/redeploy).
  API: create answers `503 AI_FEATURE_DISABLED` (poll/cancel keep working).
  Worker: `TtsJobConsumer` stops claiming (`tts consumer: TTS_GENERATION_ENABLED=false`
  in the log); in-flight jobs finish; queued jobs wait. Wired in I02 (ADR 0014).
- **Disable hybrid search:** `SEARCH_HYBRID_ENABLED=false` (ADR 0012).
- **Model rollback:** disable the bad voice/model version in the registry/voice
  manifest (`enabled: false`) and enable the previous pinned `modelVersion`
  in the SAME manifest file read by API and worker (`TTS_VOICES_MANIFEST_PATH`),
  then restart both. Drilled at I04 (`backend-i04-release-gate.md` §4):
  jobs already queued under the bad version fail fast with
  `TTS_MODEL_UNAVAILABLE` (re-create them); a new create gets a NEW job (the
  idempotency key includes `modelVersion`) that regenerates the draft audio
  under the previous version; published audio is untouched. Rolling forward
  again re-queues the old row only if the draft no longer carries its audio.
- **Frontend panel:** `NEXT_PUBLIC_TTS_GENERATION_MODE` is build-time and
  fails closed (`off` unless exactly `api`/`demo`); prefer the backend kill
  switch (no rebuild) and rebuild with `off` only to hide the panel.
- **Migration 012 rollback (ADR 0014):** the I02+ API and worker do NOT run on
  the 011 schema (API narration reads 500, worker claims fail `42703`); the
  pre-I02 API runs on both 011 and 012. Order: (1) `TTS_GENERATION_ENABLED=false`
  and stop the I02+ worker (SIGTERM drains); (2) deploy the pre-I02 API;
  (3) run `012…down.sql` and delete its `schema_migrations` row. AI provenance
  (`audio_generated_by`) is lost; audio stays. Roll forward: (1) migrate 012 up;
  (2) deploy the I02+ API; (3) start the worker. Jobs the old API stamped with
  `TTS_DEFAULT_*` fail `TTS_MODEL_UNAVAILABLE` under a manifest that lacks
  them — re-create them.

## Quotas

Wired in I02 (ADR 0014):

- API create: per-user fixed window (`TTS_QUOTA_WINDOW_MS`,
  `TTS_QUOTA_MAX_PER_WINDOW`; 60s / 120; per API process) → `429 rate_limited`;
  backlog cap on queued+running rows (`TTS_QUEUE_MAX_ACTIVE`, 50) →
  `429 concurrency_limited`. `details.retryAfterSeconds` is a hint.
- Worker: `QuotaGuard` (same window vars + `TTS_QUOTA_MAX_CONCURRENT`, 4) is
  checked with `peek()` before each claim and acquired after it, released when
  the job ends — bounding claim rate and parallel synthesis.

## Retention

`selectExpiredJobs(jobs, policy, now)` lists terminal jobs past their window
(env `TTS_RETENTION_{SUCCEEDED,FAILED,CANCELLED,DEAD_LETTER}_DAYS`; defaults
180/30/30/90). In-flight jobs are never selected. Cleanup query (manual/cron),
backed by migration 011:

```sql
DELETE FROM tts_generation_jobs
WHERE status IN ('succeeded','failed','cancelled')
  AND updated_at < now() - make_interval(days => $1);
-- keep dead-lettered rows longer (dead_lettered = true, $2 days)
```

Always back up before a bulk delete; delete in batches on large tables.

## Incident drills (acceptance)

Run these in staging and confirm the behavior (all four plus DB/S3/worker
crash, kill-switch, quota, race and API-restart drills were run on a local
real stack at I04 — results in `backend-i04-release-gate.md` §3):

1. **Provider failure:** point the provider at a failing binary → jobs retry with
   backoff, then dead-letter; `tts_job_dead_letters_total` rises and the
   `TtsDeadLetterSpike` alert fires; published audio is untouched.
2. **Full queue:** flood submissions → `QuotaGuard` returns `rate_limited` /
   `concurrency_limited`; `tts_queue_depth` stays bounded; `TtsQueueBacklog`
   fires if sustained.
3. **Corrupt audio:** feed invalid WAV → `validateSynthesizedAudio` rejects
   (`TTS_AUDIO_INVALID`); the job fails closed, never publishes.
4. **Model rollback:** disable the current model/version, enable the previous →
   new jobs use the previous version; verify output and metrics by
   `model_version`.

## Canary

Enable a new model/version for a small POI set first (registry `enabled` +
locale mapping), watch `tts_generation_duration_ms` and dead-letter metrics by
`model_version`, then widen. Roll back by flipping `enabled`.

## Verify

`npm run test --workspace @damsen/worker` covers metrics, quota, retention and
the kill switch (incl. the consumer); `npm run test --workspace @damsen/api`
covers the API kill switch/quota. Live evidence: `backend-i02-integration-fixes.md`. Fault-injection and restore drills are run in staging per above.
Operational notes from the I04 drills: after a worker crash a job reads
`running` until `TTS_JOB_STALE_RUNNING_MS` (30 min default) before it is
re-claimed; keep each manifest entry's provider `timeoutMs` ≤
`TTS_JOB_TIMEOUT_MS`, otherwise a timed-out attempt's provider process keeps
running beside the retry; keep `TTS_JOB_STALE_RUNNING_MS` above
`TTS_JOB_TIMEOUT_MS` + 120 s (bucket check + upload each have a 60 s timeout).

## Storage backup, audit and restore (C07)

Narration audio exists only in object storage; `poi_narrations.audio_*` holds
the key, MIME type, size and sha256 of every attached file.
`scripts/storage-restore-drill.mjs` uses those records:

| Command | Effect |
|---|---|
| `npm run storage:audit` | Read-only: each referenced object exists with the recorded size, sha256 (bytes re-hashed) and MIME |
| `npm run storage:backup` | Copy every referenced object to `BACKUP_S3_BUCKET` (default `${S3_BUCKET}-backup`); idempotent; never backs up a missing/corrupt primary |
| `npm run storage:restore` | Re-create missing/corrupt objects from the backup, then audit |
| `STORAGE_DRILL_CONFIRM=delete-objects npm run storage:drill` | Backup → delete `STORAGE_DRILL_LOSE` objects from the primary → audit must find exactly them → restore → audit clean; reports RTO. Refuses without the confirm env and on any bucket named `*prod*` |

Needs `DATABASE_URL` and the `S3_*` variables (same as the API). Objects are
copied by GET + PUT with the original `Content-Type`, `sha256` metadata and
`x-amz-checksum-sha256`, so the API's `verifyAudioObject` accepts a restored
object like the original. `STORAGE_DRILL_REPORT=<path>` writes a JSON report.
Schedule `storage:backup` (or use bucket replication/`mc mirror`) and
`storage:audit` daily in staging/production.

Drill evidence 2026-10-10 (Postgres 16 + moto S3 emulator, 2 AI-generated
objects mp3/m4a): backup 2/2 → 2 deleted → detection exact → restored and
re-verified in 57 ms → PASS; a corrupted object (wrong bytes) was flagged
`size_mismatch` by `audit` and repaired by `restore`; the API then served both
published narrations with matching sha256. Re-run on the target store
(MinIO/S3) at T60 — the emulator does not enforce checksums.

## Load test (C07)

`npm run load:api` drives the visitor read paths (POI list, search, narration
locales, POI narration, walking route) with `LOAD_CONCURRENCY` users for
`LOAD_DURATION_S`, then fails if any scenario's p95 exceeds `LOAD_P95_MS`
(500) or the error rate exceeds `LOAD_MAX_ERROR_RATE` (1 %). 404 on a missing
narration locale and 422 on an off-graph route origin count as handled.
`LOAD_REPORT=<path>` writes JSON.

Local result 2026-10-10 (API + Postgres 16/PostGIS/pgRouting on one 2-vCPU
container, 5 POIs, hybrid off):

| Users | req/s | p95 list / search / narration / route | Errors |
|---|---:|---|---:|
| 20 | 802 | 33 / 40 / 47 / 55 ms | 0 % |
| 100 | 931 | 152 / 144 / 181 / 325 ms | 0 % |

Routing (pgRouting) is the slowest path. Re-run on staging hardware at T60
with the full POI catalogue before setting production budgets.
