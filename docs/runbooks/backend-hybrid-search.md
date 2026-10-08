# Runbook — Hybrid semantic search (backend)

Operate the hybrid ranking layer (AI07 / T43): blend lexical + semantic order
behind a feature flag with a lexical fallback. Scope: query-time ranking. See
ADR 0012, migration 005 (`semantic_embeddings`) and
`docs/plans/AI_TTS_AND_TRAINING_ROADMAP.md` (AI07).

## Where it lives

- Fusion (pure): `apps/api/src/search/hybrid-ranking.ts`.
- Flags: `apps/api/src/search/search-flags.ts` (`SEARCH_HYBRID_*`).
- Query embedder: `apps/api/src/search/query-embedder.ts`
  (`NullQueryEmbedder` default, `HttpQueryEmbedder` via `SEARCH_EMBEDDING_URL`).
- Vector source: `postgres-vector.source.ts` (pgvector) /
  `in-memory-vector.source.ts` (stub).
- Orchestration: `apps/api/src/search/search.service.ts`
  (`tryHybrid` → fallback `lexical`).

## Enable / roll back

```
SEARCH_HYBRID_ENABLED=true        # false (default) = lexical baseline
SEARCH_HYBRID_POOL_SIZE=50        # lexical candidates re-ranked
SEARCH_HYBRID_RRF_K=60
SEARCH_HYBRID_LEX_WEIGHT=1
SEARCH_HYBRID_VEC_WEIGHT=1
SEARCH_EMBEDDING_URL=https://<embedding-service>/embed
SEARCH_EMBEDDING_MODEL=<model>            # MUST match stored embeddings
SEARCH_EMBEDDING_MODEL_VERSION=<version>  # MUST match stored embeddings
SEARCH_EMBEDDING_TIMEOUT_MS=2000
```

**Rollback = set `SEARCH_HYBRID_ENABLED=false`** (no redeploy). Hybrid is a strict
re-rank, so enabling it cannot change which POIs appear or the totals — only
their order — and any failure falls back to lexical automatically.

## Preconditions to turn it on in a shared environment

1. `semantic_embeddings` populated for the SAME model/version you set above
   (worker embedding pipeline, migration 005).
2. The embedding service reachable at `SEARCH_EMBEDDING_URL`, returning
   `{ "vector": number[1024] }`.
3. The 50-query evaluation shows no regression vs the T41 lexical baseline
   (`data/search-evaluation`); otherwise keep the flag off (ADR 0012 gate).

## Verify

- Unit (CI, no DB/model): `npm run test --workspace @damsen/api`
  (fusion, flags, embedder, hybrid service + fallback).
- Local real path: with a DB + embeddings + embedding endpoint and the flag on,
  run the 50-query HTTP evaluation:
  `python3 data/search-evaluation/run_http_search.py` →
  `python3 data/search-evaluation/evaluate.py …` and compare to
  `baseline_report.json`.

## Troubleshooting

- Results identical to lexical with the flag on: embedder returned null
  (`SEARCH_EMBEDDING_URL` unset/unreachable) or no embeddings for that
  model/version → check the endpoint and the stored model/version match.
- Deep pages (`offset ≥ pool size`) are served by the lexical ordering by design.
- Never log the query text, the vector, or raw GPS. Only ids/metrics.
