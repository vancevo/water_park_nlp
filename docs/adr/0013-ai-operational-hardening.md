# ADR 0013 — AI/TTS operational hardening

- Status: Accepted (AI08 / C07; metrics endpoint, restore drill and load test
  added 2026-10-10)
- Date: 2026-10-08
- Deciders: Công (backend), coordinator
- Related: `docs/plans/AI_TTS_AND_TRAINING_ROADMAP.md` (AI08), ADR 0008–0012, migration 010/011

## Context

AI02–AI07 built the TTS pipeline and hybrid search. AI08 makes them operable:
observable, rate-limited, retainable and rollback-able — without new AI
capability, and without any PII entering telemetry. CI has no Postgres, no
metrics backend and no engines, so the controls must be pure/unit-testable and
transport-agnostic.

## Decision

1. **Transport-agnostic metrics.** A dependency-free `MetricsRegistry`
   (counters/gauges/histograms) with Prometheus text + JSON exposition. Label
   values are sanitized (single line, length-capped) and limited to
   low-cardinality operational fields. Transcripts, prompts, queries and raw GPS
   never enter metrics or logs.
2. **Kill switches default ON.** `TTS_GENERATION_ENABLED` (worker) and
   `SEARCH_HYBRID_ENABLED` (API) are independent flags; off is the rollback, no
   redeploy. Model rollback uses the registry `enabled` flag + pinned
   `modelVersion`; idempotency means re-generation under the previous version
   never disturbs published audio.
3. **Quotas.** A per-key fixed-window rate limit + concurrency cap
   (`QuotaGuard`) prevents resource exhaustion; defaults 60s / 120 / 4,
   env-overridable.
4. **Retention as pure policy.** `selectExpiredJobs` decides which TERMINAL jobs
   are past their window (succeeded 180d, failed/cancelled 30d, dead-letter 90d,
   env-overridable); in-flight jobs are never expired. Deletion is an operational
   step (runbook + migration 011 index), never automatic in this layer.
5. **Alerts + runbook as the produced contract.** `infra/observability/tts-alerts.yaml`
   and `docs/runbooks/backend-ai-operations.md` define dead-letter/backlog/latency/
   failure-ratio alerts and the incident, canary and rollback drills.

## Out of scope / deferred

- ~~Wiring a metrics HTTP endpoint and a scrape target~~ — **done 2026-10-10
  (C07):** the worker serves `GET /metrics` + `/healthz`
  (`apps/worker/src/ops/metrics-server.ts`, `WORKER_METRICS_*`); the live
  consumer already records the series since I02. Scrape config:
  `infra/observability/README.md`.
- ~~The storage backup/restore drill~~ — **done 2026-10-10 (C07):**
  `scripts/storage-restore-drill.mjs` (audit/backup/restore/drill) re-hashes
  every DB-referenced audio object and restores from a backup bucket; drill
  PASS on an S3 emulator (`backend-ai-operations.md`). Re-run on the target
  store (MinIO/S3) at T60.
- Load test of the visitor read paths: `scripts/load-test.mjs` (C07).

## Consequences

- The pipeline is observable and controllable with pure, tested modules; turning
  controls on is wiring, not new logic.
- Enabling/rolling back a model or a feature is an env/registry change with a
  documented drill, bounding operational risk.
- No migration rewrites; 011 adds a reversible retention index only.
