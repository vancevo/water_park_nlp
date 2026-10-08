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
