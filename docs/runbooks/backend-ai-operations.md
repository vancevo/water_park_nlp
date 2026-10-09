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
(labels: status/provider/model/model_version/error_code only). Expose with
`registry.toPrometheus()`. **Never** log or label a transcript, prompt, query or
raw GPS.

## Kill switches / rollback

- **Disable TTS generation:** `TTS_GENERATION_ENABLED=false` (default on) on
  BOTH processes, then restart them (env is read at boot; no rebuild/redeploy).
  API: create answers `503 AI_FEATURE_DISABLED` (poll/cancel keep working).
  Worker: `TtsJobConsumer` stops claiming (`tts consumer: TTS_GENERATION_ENABLED=false`
  in the log); in-flight jobs finish; queued jobs wait. Wired in I02 (ADR 0014).
- **Disable hybrid search:** `SEARCH_HYBRID_ENABLED=false` (ADR 0012).
- **Model rollback:** disable the bad voice/model version in the registry/voice
  manifest (`enabled: false`) and enable the previous pinned `modelVersion`.
  Because jobs are idempotent by `narrationId+transcriptHash+modelVersion`, a
  rollback re-generates under the previous version without touching published
  audio.

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

Run these in staging and confirm the behavior:

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
`B03` (real object storage smoke) remains open and gates the storage-restore
drill.
