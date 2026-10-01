import type { TtsArtifact, TtsJobRecord, TtsJobRepository } from './types.js';

export interface QueryResult<Row> {
  rows: Row[];
}

/** Compatible with pg Pool/Client without the worker owning a DB driver. */
export interface SqlQueryClient {
  query<Row extends Record<string, unknown>>(
    text: string,
    values?: readonly unknown[],
  ): Promise<QueryResult<Row>>;
}

interface JobRow extends Record<string, unknown> {
  id: string;
  narration_id: string;
  status: TtsJobRecord['status'];
  provider: string;
  model: string;
  model_version: string;
  transcript_hash: string;
  idempotency_key: string;
  attempts: number | string;
  max_attempts: number | string;
  dead_lettered: boolean;
  error_code: string | null;
  artifact: TtsArtifact | null;
  created_at: string | Date;
  updated_at: string | Date;
}

const COLUMNS = `id::text, narration_id::text, status, provider, model,
  model_version, transcript_hash, idempotency_key, attempts, max_attempts,
  dead_lettered, error_code, artifact, created_at, updated_at`;

export class PostgresTtsJobRepository implements TtsJobRepository {
  constructor(private readonly database: SqlQueryClient) {}

  async findByIdempotencyKey(key: string): Promise<TtsJobRecord | null> {
    const result = await this.database.query<JobRow>(
      `SELECT ${COLUMNS} FROM tts_generation_jobs WHERE idempotency_key = $1`,
      [key],
    );
    return this.map(result.rows[0]);
  }

  async findById(id: string): Promise<TtsJobRecord | null> {
    const result = await this.database.query<JobRow>(
      `SELECT ${COLUMNS} FROM tts_generation_jobs WHERE id = $1`,
      [id],
    );
    return this.map(result.rows[0]);
  }

  async save(record: TtsJobRecord): Promise<void> {
    await this.database.query(
      `INSERT INTO tts_generation_jobs (
         id, narration_id, status, provider, model, model_version,
         transcript_hash, idempotency_key, attempts, max_attempts,
         dead_lettered, error_code, artifact, created_at, updated_at
       ) VALUES (
         $1::uuid, $2::uuid, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12,
         $13::jsonb, $14, $15
       )
       ON CONFLICT (id) DO UPDATE SET
         status = EXCLUDED.status,
         attempts = EXCLUDED.attempts,
         max_attempts = EXCLUDED.max_attempts,
         dead_lettered = EXCLUDED.dead_lettered,
         error_code = EXCLUDED.error_code,
         artifact = EXCLUDED.artifact,
         updated_at = EXCLUDED.updated_at`,
      [
        record.id,
        record.narrationId,
        record.status,
        record.provider,
        record.model,
        record.modelVersion,
        record.transcriptHash,
        record.idempotencyKey,
        record.attempts,
        record.maxAttempts,
        record.deadLettered,
        record.errorCode,
        record.artifact === null ? null : JSON.stringify(record.artifact),
        record.createdAt.toISOString(),
        record.updatedAt.toISOString(),
      ],
    );
  }

  private map(row: JobRow | undefined): TtsJobRecord | null {
    if (!row) return null;
    return {
      id: row.id,
      narrationId: row.narration_id,
      status: row.status,
      provider: row.provider,
      model: row.model,
      modelVersion: row.model_version,
      transcriptHash: row.transcript_hash,
      idempotencyKey: row.idempotency_key,
      attempts: Number(row.attempts),
      maxAttempts: Number(row.max_attempts),
      deadLettered: row.dead_lettered,
      errorCode: row.error_code,
      artifact: row.artifact,
      createdAt: new Date(row.created_at),
      updatedAt: new Date(row.updated_at),
    };
  }
}
