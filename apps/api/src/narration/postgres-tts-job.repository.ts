import type { SqlClient } from '../poi/postgres-poi.repository.js';
import type { TtsJobRecord, TtsJobRepository } from './tts-job.models.js';

/**
 * Admin-side persistence for `tts_generation_jobs` (migration 010). The API only
 * writes `queued`/`cancelled` rows with a null artifact; the worker owns running
 * jobs and the artifact manifest. Columns and the artifact-state check live in
 * migration 010 — this repository never writes an artifact.
 */

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
  created_at: string | Date;
  updated_at: string | Date;
}

const COLUMNS = `id::text, narration_id::text, status, provider, model,
  model_version, transcript_hash, idempotency_key, attempts, max_attempts,
  dead_lettered, error_code, created_at, updated_at`;

export class PostgresTtsJobRepository implements TtsJobRepository {
  constructor(private readonly database: SqlClient) {}

  async findById(id: string): Promise<TtsJobRecord | null> {
    const result = await this.database.query<JobRow>(
      `SELECT ${COLUMNS} FROM tts_generation_jobs WHERE id = $1`,
      [id],
    );
    return this.map(result.rows[0]);
  }

  async findByIdempotencyKey(key: string): Promise<TtsJobRecord | null> {
    const result = await this.database.query<JobRow>(
      `SELECT ${COLUMNS} FROM tts_generation_jobs WHERE idempotency_key = $1`,
      [key],
    );
    return this.map(result.rows[0]);
  }

  async insert(record: TtsJobRecord): Promise<void> {
    await this.database.query(
      `INSERT INTO tts_generation_jobs (
         id, narration_id, status, provider, model, model_version,
         transcript_hash, idempotency_key, attempts, max_attempts,
         dead_lettered, error_code, artifact, created_at, updated_at
       ) VALUES (
         $1::uuid, $2::uuid, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12,
         NULL, $13, $14
       )`,
      this.values(record),
    );
  }

  async save(record: TtsJobRecord): Promise<void> {
    await this.database.query(
      `INSERT INTO tts_generation_jobs (
         id, narration_id, status, provider, model, model_version,
         transcript_hash, idempotency_key, attempts, max_attempts,
         dead_lettered, error_code, artifact, created_at, updated_at
       ) VALUES (
         $1::uuid, $2::uuid, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12,
         NULL, $13, $14
       )
       ON CONFLICT (id) DO UPDATE SET
         status = EXCLUDED.status,
         attempts = EXCLUDED.attempts,
         max_attempts = EXCLUDED.max_attempts,
         dead_lettered = EXCLUDED.dead_lettered,
         error_code = EXCLUDED.error_code,
         updated_at = EXCLUDED.updated_at`,
      this.values(record),
    );
  }

  private values(record: TtsJobRecord): readonly unknown[] {
    return [
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
      record.createdAt.toISOString(),
      record.updatedAt.toISOString(),
    ];
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
      createdAt: new Date(row.created_at),
      updatedAt: new Date(row.updated_at),
    };
  }
}
