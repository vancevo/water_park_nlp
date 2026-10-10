# ADR 0012 — Hybrid semantic search ranking

- Status: Accepted (AI07 / C06, partial — ranking layer)
- Date: 2026-10-08
- Deciders: Công (backend), coordinator
- Related: `docs/plans/AI_TTS_AND_TRAINING_ROADMAP.md` (AI07), `PROJECT_PLAN.md` §8/§13, ADR 0001, migration 005 (`semantic_embeddings`)

## Context

T41 gave us a lexical search (Postgres FTS + accent-insensitive/fuzzy + distance)
with a fixed 50-query evaluation (Recall@10/MRR/nDCG@10). T42 added the embedding
pipeline and `semantic_embeddings` (pgvector, 1024-d, HNSW cosine). AI07/T43 adds
hybrid ranking: blend the lexical and semantic signals, behind a feature flag,
with a lexical fallback and an easy rollback. CI has no Postgres/pgvector and no
embedding model, and a production embedding endpoint is not yet selected, so the
ranking layer must be fully testable and safe without any of them.

## Decision

1. **Reciprocal Rank Fusion (RRF).** The lexical score (ts_rank + trigram
   similarity + distance) and cosine similarity are not on a comparable scale, so
   we fuse the two *orderings* by RRF (`score = Σ w_i/(k + rank_i)`), not the raw
   scores. The fusion is a pure, deterministic function
   (`apps/api/src/search/hybrid-ranking.ts`).
2. **Semantic re-ranking of the lexical pool (this slice).** With the flag on,
   the service takes the top `poolSize` lexical candidates, asks the vector source
   for their semantic order, fuses, re-sorts and paginates. Re-ranking preserves
   the candidate SET, so `total` and pagination stay identical to the lexical
   baseline. Vector-only recall expansion (surfacing POIs the lexical query
   missed) is deferred to integration/I03 with the full corpus.
3. **Feature flag + instant rollback.** `SEARCH_HYBRID_ENABLED` (default
   `false`) plus `SEARCH_HYBRID_POOL_SIZE`/`RRF_K`/`LEX_WEIGHT`/`VEC_WEIGHT`.
   Rollback is flipping the flag — no logic redeploy. When off, search is byte-
   for-byte the lexical baseline.
4. **Fail closed to lexical.** The query is embedded out-of-process by a
   `QueryEmbedder` (null unless `SEARCH_EMBEDDING_URL` is set — no model runs in
   the API). Any missing vector, empty pool, deep page (offset ≥ poolSize), or
   error in the embedder/vector source returns the lexical result. A vector
   outage never degrades search below lexical.
5. **Model/version must match.** The `QueryEmbedder` and the
   `PostgresVectorCandidateSource` are pinned to the same model/version used to
   build the stored document embeddings; mismatched vectors are never compared.
6. **Observability of the signal.** A result the vector ranked carries the new
   additive `semantic` `SearchReason` (shared-types + OpenAPI enum). Existing
   reasons are unchanged; no consumer switches exhaustively on the enum.

## Out of scope / deferred

- Selecting and hosting the production embedding provider (benchmark T41/AI05
  style) and wiring `SEARCH_EMBEDDING_URL`.
- Vector-only recall expansion beyond the lexical pool.
- The real pgvector smoke + the 50-query HTTP evaluation numbers — run locally /
  at I03; the lexical baseline report stays the gate until then. Threshold: hybrid
  must not drop Recall@10/MRR/nDCG@10 below the T41 baseline (per §13), confirmed
  before the flag goes on in any shared environment.

## Consequences

- The ranking layer is complete, pure-unit-tested and safe to ship dark (flag
  off). Turning it on needs only a DB with embeddings and an embedding endpoint.
- No migration or worker change; `semantic_embeddings` (005) is reused as-is.
- Hybrid is a strict re-rank, so turning it on cannot change which results appear
  or the totals — only their order — which bounds the risk of enabling it.

## Amendment 2026-10-10 (C06) — free local embeddings + vector recall expansion

1. **Embedding provider: BAAI/bge-m3, run locally for free.** MIT licence,
   multilingual (incl. Vietnamese), 1024 dims (matches migration 005), served by
   `tools/embedding-runtime/server.mjs` (transformers.js + onnxruntime on CPU,
   `Xenova/bge-m3` int8 ONNX ≈ 570 MB, downloaded once). No API key or paid
   service. The HTTP protocol (`apps/worker/src/embedding/embedding-server.ts`)
   is model-agnostic: `POST /embed` (API query embedder), `POST /embed/batch`
   (indexer), `GET /healthz`; requests naming another model/version get 409.
   The runtime lives outside the npm workspaces so CI never installs it.
2. **Indexing.** `npm run embeddings:index --workspace @damsen/worker` embeds
   every published POI translation through the service; model/version are read
   from `/healthz`, so stored vectors and queries always match. Idempotent by
   content hash; `--force` re-embeds.
3. **Vector-only recall expansion (was deferred).** With hybrid on, POIs the
   lexical query missed are added when cosine similarity ≥
   `SEARCH_HYBRID_MIN_SIMILARITY` (default 0.5), at most
   `SEARCH_HYBRID_EXPAND_LIMIT` (3), still passing category/radius/open-now
   filters; `SEARCH_HYBRID_EXPAND=false` restores strict re-ranking. The pool
   order is fused by RRF as before, so lexical hits keep priority; added POIs
   carry the `semantic` reason. `total` = lexical total + added. Fail-closed
   behaviour is unchanged.
4. **Calibration.** The similarity floor depends on the model. The demo setup
   calibrates it on the model actually installed: the floor is set just above
   the highest similarity any of the 5 expected-zero ("nonsense") queries
   reaches, so expansion never invents results for them
   (`scripts/demo/calibrate-search.mjs`). This tunes on the evaluation set —
   acceptable for the demo, not a substitute for a held-out set.

Verified 2026-10-10 on Postgres 16 + pgvector with a stand-in tiny model (the
real weights are not reachable from the build environment): indexing 10/10,
idempotent re-run 0/10, API hybrid + expansion end-to-end, and the toy model's
uncalibrated floor admitting nonsense queries — which is why step 4 exists.
