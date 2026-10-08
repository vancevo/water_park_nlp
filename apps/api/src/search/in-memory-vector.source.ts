import type {
  VectorCandidateSource,
  VectorHit,
  VectorSearchQuery,
} from './search.models.js';

/**
 * Deterministic vector source for tests and DATABASE_URL-less runs. Seeded with
 * precomputed POI similarities so the hybrid path is fully testable without a
 * model or pgvector. It ignores the query vector and returns the seeded
 * similarities, restricted to the requested pool and sorted desc.
 */
export class InMemoryVectorCandidateSource implements VectorCandidateSource {
  constructor(
    private readonly similarities: ReadonlyMap<string, number> = new Map(),
  ) {}

  async search(query: VectorSearchQuery): Promise<VectorHit[]> {
    const ids = query.poiIds ?? [...this.similarities.keys()];
    return ids
      .filter((id) => this.similarities.has(id))
      .map((id) => ({ poiId: id, similarity: this.similarities.get(id)! }))
      .sort(
        (a, b) => b.similarity - a.similarity || a.poiId.localeCompare(b.poiId),
      )
      .slice(0, query.limit);
  }
}
