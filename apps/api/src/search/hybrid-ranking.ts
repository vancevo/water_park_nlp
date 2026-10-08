/**
 * Hybrid ranking fusion (AI07 / T43). Combines the lexical ranking with the
 * semantic (vector) ranking using Reciprocal Rank Fusion (RRF), which blends two
 * ordered lists without needing their scores on a shared scale — robust when the
 * lexical score (ts_rank + similarity + distance) and the cosine similarity are
 * not comparable numbers.
 *
 * Pure and deterministic: given the two id orderings it always returns the same
 * fused order (ties broken by id), so it is fully unit-testable with no engine,
 * database or model.
 */

export interface FusionWeights {
  /** RRF dampening constant; larger = flatter contribution of top ranks. */
  k: number;
  lexWeight: number;
  vecWeight: number;
}

export const DEFAULT_FUSION_WEIGHTS: FusionWeights = {
  k: 60,
  lexWeight: 1,
  vecWeight: 1,
};

export interface FusedEntry {
  id: string;
  score: number;
  inLexical: boolean;
  inVector: boolean;
}

function rankMap(order: readonly string[]): Map<string, number> {
  const map = new Map<string, number>();
  order.forEach((id, index) => {
    if (!map.has(id)) map.set(id, index); // first occurrence wins
  });
  return map;
}

/**
 * Fuse a lexical and a vector ranking (each best-first) into one ordering.
 * Returns every id present in either list, scored by RRF and sorted desc, with
 * a stable id tie-break.
 */
export function fuseRankings(
  lexicalOrder: readonly string[],
  vectorOrder: readonly string[],
  weights: FusionWeights = DEFAULT_FUSION_WEIGHTS,
): FusedEntry[] {
  const k = weights.k > 0 ? weights.k : DEFAULT_FUSION_WEIGHTS.k;
  const lexWeight = Math.max(0, weights.lexWeight);
  const vecWeight = Math.max(0, weights.vecWeight);

  const lexRank = rankMap(lexicalOrder);
  const vecRank = rankMap(vectorOrder);
  const ids = new Set<string>([...lexRank.keys(), ...vecRank.keys()]);

  const entries: FusedEntry[] = [];
  for (const id of ids) {
    const lexAt = lexRank.get(id);
    const vecAt = vecRank.get(id);
    const score =
      (lexAt === undefined ? 0 : lexWeight / (k + lexAt + 1)) +
      (vecAt === undefined ? 0 : vecWeight / (k + vecAt + 1));
    entries.push({
      id,
      score,
      inLexical: lexAt !== undefined,
      inVector: vecAt !== undefined,
    });
  }

  return entries.sort((a, b) => b.score - a.score || a.id.localeCompare(b.id));
}
