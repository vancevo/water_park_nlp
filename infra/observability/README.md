# Observability — AI/TTS pipeline (AI08)

Operational metrics for the TTS/AI pipeline are produced by
`apps/worker/src/ops` and are transport-agnostic:

- `MetricsRegistry.toPrometheus()` → Prometheus text exposition, served by the
  worker at `GET /metrics` (C07; `apps/worker/src/ops/metrics-server.ts`), or
- `MetricsRegistry.snapshot()` → JSON for a custom exporter.

## Scrape the worker

The worker listens on `WORKER_METRICS_HOST:WORKER_METRICS_PORT`
(default `127.0.0.1:9464`; `WORKER_METRICS_ENABLED=false` turns it off). It
serves `GET /metrics` (text format 0.0.4) and `GET /healthz` (`ok`). There is
no authentication: bind to a private interface only. A bind failure is logged
and generation continues.

```yaml
# prometheus.yml
scrape_configs:
  - job_name: damsen-tts-worker
    scrape_interval: 15s
    static_configs:
      - targets: ['tts-worker:9464']
rule_files:
  - infra/observability/tts-alerts.yaml
```

Add `up{job="damsen-tts-worker"} == 0` as a page if the worker must never be
silently down.

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
