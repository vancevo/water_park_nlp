import type {
  EmbeddingRepository,
  EmbeddingWrite,
  PoiEmbeddingSource,
  StoredEmbeddingMetadata,
  SupportedLocale,
} from './types.js';

export interface QueryResult<Row> {
  rows: Row[];
}

/** Compatible with pg Pool/Client without making the worker own a DB driver. */
export interface SqlQueryClient {
  query<Row extends Record<string, unknown>>(
    text: string,
    values?: readonly unknown[],
  ): Promise<QueryResult<Row>>;
}

interface PoiRow extends Record<string, unknown> {
  id: string;
  locale: SupportedLocale;
  name: string;
  category: string;
  short_description: string;
  long_description: string;
}

interface MetadataRow extends Record<string, unknown> {
  entity_type: string;
  entity_id: string;
  locale: SupportedLocale;
  content_hash: string;
}

export class PostgresEmbeddingRepository implements EmbeddingRepository {
  constructor(private readonly database: SqlQueryClient) {}

  async listPublishedPoiSources(): Promise<readonly PoiEmbeddingSource[]> {
    const result = await this.database.query<PoiRow>(`
      SELECT p.id::text, t.locale, t.name, c.slug AS category,
             t.short_description, t.long_description
      FROM pois p
      JOIN poi_categories c ON c.id = p.category_id
      JOIN poi_translations t ON t.poi_id = p.id
      WHERE p.status = 'published'
      ORDER BY p.id, t.locale
    `);
    return result.rows.map((row) => ({
      id: row.id,
      locale: row.locale,
      name: row.name,
      category: row.category,
      shortDescription: row.short_description,
      longDescription: row.long_description,
    }));
  }

  async listMetadata(
    model: string,
    modelVersion: string,
  ): Promise<readonly StoredEmbeddingMetadata[]> {
    const result = await this.database.query<MetadataRow>(
      `SELECT entity_type, entity_id::text, locale, content_hash
       FROM semantic_embeddings
       WHERE model = $1 AND model_version = $2`,
      [model, modelVersion],
    );
    return result.rows.map((row) => ({
      entityType: row.entity_type,
      entityId: row.entity_id,
      locale: row.locale,
      contentHash: row.content_hash,
    }));
  }

  async upsertMany(records: readonly EmbeddingWrite[]): Promise<void> {
    if (records.length === 0) return;
    const values: unknown[] = [];
    const rows = records.map((record, index) => {
      const start = index * 7;
      values.push(
        record.document.entityType,
        record.document.entityId,
        record.document.locale,
        record.model,
        record.modelVersion,
        record.document.contentHash,
        vectorLiteral(record.vector),
      );
      return `($${start + 1}, $${start + 2}::uuid, $${start + 3}, $${start + 4}, $${start + 5}, $${start + 6}, $${start + 7}::vector)`;
    });
    await this.database.query(
      `INSERT INTO semantic_embeddings
         (entity_type, entity_id, locale, model, model_version, content_hash, embedding)
       VALUES ${rows.join(', ')}
       ON CONFLICT (entity_type, entity_id, locale, model, model_version)
       DO UPDATE SET content_hash = EXCLUDED.content_hash,
                     embedding = EXCLUDED.embedding,
                     updated_at = now()`,
      values,
    );
  }
}

function vectorLiteral(vector: readonly number[]): string {
  if (
    vector.length !== 1024 ||
    vector.some((value) => !Number.isFinite(value))
  ) {
    throw new Error('PostgreSQL embedding must contain 1024 finite numbers');
  }
  return `[${vector.join(',')}]`;
}
