import {
  DEFAULT_FUSION_WEIGHTS,
  type FusionWeights,
} from './hybrid-ranking.js';

/**
 * Runtime feature flags for search (AI07). Hybrid semantic ranking is OFF by
 * default — a rollback is a single env change (`SEARCH_HYBRID_ENABLED=false`)
 * with no redeploy of logic. When off, search behaves exactly as the lexical
 * baseline.
 */
export interface SearchFlags {
  hybridEnabled: boolean;
  /** How many lexical candidates to re-rank with the vector signal. */
  poolSize: number;
  weights: FusionWeights;
  /**
   * Vector-only recall expansion (C06, ADR 0012 amendment): POIs the lexical
   * query missed are added when their cosine similarity to the query is at
   * least `minSimilarity` — at most `limit` of them.
   */
  expand?: { enabled: boolean; minSimilarity: number; limit: number };
}

function unitEnv(value: string | undefined, fallback: number): number {
  const n = Number(value);
  return value !== undefined &&
    value !== '' &&
    Number.isFinite(n) &&
    n >= 0 &&
    n <= 1
    ? n
    : fallback;
}

function intEnv(value: string | undefined, fallback: number): number {
  const n = Number(value);
  return Number.isInteger(n) && n > 0 ? n : fallback;
}

function numEnv(value: string | undefined, fallback: number): number {
  const n = Number(value);
  return Number.isFinite(n) && n >= 0 ? n : fallback;
}

export function loadSearchFlags(
  env: NodeJS.ProcessEnv = process.env,
): SearchFlags {
  return {
    hybridEnabled: env.SEARCH_HYBRID_ENABLED === 'true',
    poolSize: intEnv(env.SEARCH_HYBRID_POOL_SIZE, 50),
    weights: {
      k: intEnv(env.SEARCH_HYBRID_RRF_K, DEFAULT_FUSION_WEIGHTS.k),
      lexWeight: numEnv(
        env.SEARCH_HYBRID_LEX_WEIGHT,
        DEFAULT_FUSION_WEIGHTS.lexWeight,
      ),
      vecWeight: numEnv(
        env.SEARCH_HYBRID_VEC_WEIGHT,
        DEFAULT_FUSION_WEIGHTS.vecWeight,
      ),
    },
    expand: {
      enabled: env.SEARCH_HYBRID_EXPAND !== 'false',
      minSimilarity: unitEnv(env.SEARCH_HYBRID_MIN_SIMILARITY, 0.5),
      limit: intEnv(env.SEARCH_HYBRID_EXPAND_LIMIT, 3),
    },
  };
}
