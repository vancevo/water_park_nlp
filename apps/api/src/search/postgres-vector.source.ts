import type { SqlClient } from '../poi/postgres-poi.repository.js';
import type {
  VectorCandidateSource,
  VectorHit,
  VectorSearchQuery,
} from './search.models.js';

interface VectorRow {
  poi_id: string;
  similarity: number | string;
}

/**
 * pgvector-backed semantic neighbours over `semantic_embeddings` (migration
 * 005, HNSW cosine). Returns cosine similarity (1 - distance) for the matching
 * model/version, optionally restricted to a POI id pool for re-ranking. The
 * model/version MUST match the query embedder so vectors are comparable.
 */
export class PostgresVectorCandidateSource implements VectorCandidateSource {
  constructor(
    private readonly client: SqlClient,
    private readonly model: string,
    private readonly modelVersion: string,
  ) {}

  async search(query: VectorSearchQuery): Promise<VectorHit[]> {
    const literal = `[${query.vector.join(',')}]`;
    const values: unknown[] = [
      literal,
      query.locale,
      this.model,
      this.modelVersion,
    ];
    let poolFilter = '';
    if (query.poiIds && query.poiIds.length > 0) {
      values.push(query.poiIds);
      poolFilter = `AND entity_id = ANY($${values.length}::uuid[])`;
    }
    values.push(query.limit);
    const limitParam = `$${values.length}`;
    const sql = `
      SELECT entity_id::text AS poi_id,
             1 - (embedding <=> $1::vector) AS similarity
      FROM semantic_embeddings
      WHERE entity_type = 'poi'
        AND locale = $2
        AND model = $3
        AND model_version = $4
        ${poolFilter}
      ORDER BY embedding <=> $1::vector
      LIMIT ${limitParam}`;
    const result = await this.client.query<VectorRow>(sql, values);
    return result.rows.map((row) => ({
      poiId: row.poi_id,
      similarity: Number(row.similarity),
    }));
  }
}
