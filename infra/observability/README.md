# Observability — AI/TTS pipeline (AI08)

Operational metrics for the TTS/AI pipeline are produced by
`apps/worker/src/ops` and are transport-agnostic:

- `MetricsRegistry.toPrometheus()` → Prometheus text exposition (scrape it from
  the worker once a metrics endpoint is wired), or
- `MetricsRegistry.snapshot()` → JSON for a custom exporter.

## Series

| Metric | Type | Labels |
|---|---|---|
| `tts_jobs_total` | counter | `status, provider, model, model_version` |
| `tts_job_retries_total` | counter | `provider, model` |
| `tts_job_dead_letters_total` | counter | `provider, error_code` |
| `tts_generation_duration_ms` | histogram | `provider, model` |
| `tts_queue_depth` | gauge | `status` |

Label values are sanitized and low-cardinality — **never** a transcript, prompt,
query or raw GPS.

## Files

- `tts-alerts.yaml` — Prometheus alerting rules (dead-letter spike, queue
  backlog, slow p95, failure ratio). Tune thresholds per environment.

See `docs/runbooks/backend-ai-operations.md` for quotas, retention, rollback and
incident drills.
