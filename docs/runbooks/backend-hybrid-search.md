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
3. Both checks pass, otherwise keep the flag off:
   a. **ADR 0012 gate (unchanged):** Recall@10/MRR/nDCG@10 not below the T41
      baseline (`baseline_report.json`, 0.911/0.906/0.900). The live API is
      at 0.900/0.894/0.890 after L3 (see below) — 0.011 short, so this gate
      still FAILS; only an ADR 0012 amendment approved by the coordinator may
      re-base it.
   b. **No regression vs the live API with the flag OFF** on the same
      database (run both with `run_http_search.py`). This isolates the effect
      of the flag, because `baseline_report.json` is the Python bag-of-words
      runner (`lexical_baseline.py`), not the API.

## Verify

- Unit (CI, no DB/model): `npm run test --workspace @damsen/api`
  (fusion, flags, embedder, hybrid service + fallback).
- Local real path: with a DB + embeddings + embedding endpoint and the flag on,
  run the 50-query HTTP evaluation:
  `python3 data/search-evaluation/run_http_search.py` →
  `python3 data/search-evaluation/evaluate.py …` and compare to both
  `baseline_report.json` (gate a) and the same run with
  `SEARCH_HYBRID_ENABLED=false` (check b).

## Live lexical baseline (I04, 2026-10-09)

Measured on the 5 fixture POIs (migrations 001–012, `damsen_i04`), API with
`SEARCH_HYBRID_ENABLED=false`; identical with the flag on and no embedder:

| Metric | Live API, flag off (check b reference) | `baseline_report.json` (T41 Python runner, gate a) |
|---|---:|---:|
| Recall@10 / MRR / nDCG@10 | 0.600 / 0.600 / 0.600 | 0.911 / 0.906 / 0.900 |
| Zero-result rate | 0.46 | 0.10 |
| Expected-zero accuracy | 1.00 | 0.60 |
| Recall@10 exact / no-diacritic / typo | 1.0 / 1.0 / 1.0 | 1.0 / 1.0 / 1.0 |
| Recall@10 semantic_intent / category_location | 0.1 / 0.0 | 0.9 / 0.667 |

Root cause of the gap (not a regression; T40 already recorded 0.60): the API
matches with `plainto_tsquery`, which ANDs every query token, over
name + descriptions only; the Python runner scores any matching token (OR) and
also indexes the category slug. So natural-language queries with words absent
from the POI text ("learn how the water cycle works") and category/location
phrasings ("garden category", "westernmost …") return nothing from the API.
Hybrid re-ranks the lexical set (ADR 0012) and cannot recover them. Raising
recall needs a lexical change (OR/websearch tsquery with a minimum-match rule,
category labels in the document) or vector retrieval as a candidate source —
a search follow-up with its own evaluation, not a flag flip.

## After L3 — OR matching with minimum-match (2026-10-09)

`PostgresSearchRepository` now matches on the significant query terms
(`searchTerms()` in `search-text.ts`: stopwords and meta words like
"category"/"POI" removed): a POI matches when it contains at least half of them
(rounded up) in its name, descriptions or **category slug**, or when the whole
name is a close fuzzy match (typos). Terms are `[a-z0-9]` only, so the OR
`tsquery` is injection-safe. No migration: the existing GIN indexes still serve
the name fuzzy branch; term counting runs on the already-filtered POI rows.

| Metric (live API, flag off, 50 queries) | Before | After L3 | T41 Python baseline |
|---|---:|---:|---:|
| Recall@10 / MRR / nDCG@10 | 0.600 / 0.600 / 0.600 | **0.900 / 0.894 / 0.890** | 0.911 / 0.906 / 0.900 |
| Zero-result rate | 0.46 | 0.18 | 0.10 |
| Expected-zero accuracy | 1.00 | 1.00 | 0.60 |
| semantic_intent / category_location | 0.1 / 0.0 | 0.8 / 0.72 | 0.9 / 0.667 |
| Latency (4 queries ×10, local) | — | p50 12 ms, p95 18 ms | — |

The 4 remaining misses are not lexical: `q021`/`q026` need the word "music"
(the DB has no tags/synonyms for "Sân Khấu Gió / Wind Stage") and `q043`/`q045`
are cardinal-direction questions ("xa nhất về phía đông") that need geo-intent
parsing. They are what vector retrieval / a keywords field would address, so
they stay with the hybrid path (needs a production embedding endpoint). The
baseline's higher zero-result *accuracy loss* (0.60) comes from returning
noise for the 5 nonsense queries; the API returns nothing for all 5.

## Troubleshooting

- Results identical to lexical with the flag on: embedder returned null
  (`SEARCH_EMBEDDING_URL` unset/unreachable) or no embeddings for that
  model/version → check the endpoint and the stored model/version match.
- Deep pages (`offset ≥ pool size`) are served by the lexical ordering by design.
- Never log the query text, the vector, or raw GPS. Only ids/metrics.
