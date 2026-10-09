import type { SqlClient } from '../poi/postgres-poi.repository.js';
import type {
  TtsJobArtifactRecord,
  TtsJobRecord,
  TtsJobRepository,
} from './tts-job.models.js';

/**
 * Admin-side persistence for `tts_generation_jobs` (migration 010). The API
 * writes `queued` rows, re-enqueues terminal ones and cancels active ones —
 * each transition is a single conditional UPDATE so it never races the
 * worker's own conditional writes (I02-2). The API never writes an artifact.
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
  artifact: TtsJobArtifactRecord | null;
  created_at: string | Date;
  updated_at: string | Date;
}

const COLUMNS = `id::text, narration_id::text, status, provider, model,
  model_version, transcript_hash, idempotency_key, attempts, max_attempts,
  dead_lettered, error_code, artifact, created_at, updated_at`;

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

  async findLatestByNarration(
    narrationId: string,
  ): Promise<TtsJobRecord | null> {
    const result = await this.database.query<JobRow>(
      `SELECT ${COLUMNS} FROM tts_generation_jobs WHERE narration_id = $1
       ORDER BY created_at DESC, id DESC LIMIT 1`,
      [narrationId],
    );
    return this.map(result.rows[0]);
  }

  async hasActiveForNarration(narrationId: string): Promise<boolean> {
    const result = await this.database.query<{ id: string }>(
      `SELECT id::text FROM tts_generation_jobs
       WHERE narration_id = $1 AND status IN ('queued', 'running') LIMIT 1`,
      [narrationId],
    );
    return result.rows.length > 0;
  }

  async countActive(): Promise<number> {
    const result = await this.database.query<{ count: string | number }>(
      `SELECT count(*) AS count FROM tts_generation_jobs
       WHERE status IN ('queued', 'running')`,
    );
    return Number(result.rows[0]?.count ?? 0);
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
        record.createdAt.toISOString(),
        record.updatedAt.toISOString(),
      ],
    );
  }

  async requeue(record: TtsJobRecord): Promise<boolean> {
    const result = await this.database.query<{ id: string }>(
      `UPDATE tts_generation_jobs
       SET status = 'queued', provider = $2, model = $3, model_version = $4,
           attempts = 0, max_attempts = $5, dead_lettered = false,
           error_code = NULL, artifact = NULL, updated_at = $6
       WHERE id = $1 AND status IN ('failed', 'cancelled')
       RETURNING id::text`,
      [
        record.id,
        record.provider,
        record.model,
        record.modelVersion,
        record.maxAttempts,
        record.updatedAt.toISOString(),
      ],
    );
    return result.rows.length === 1;
  }

  async cancelIfActive(id: string, at: Date): Promise<TtsJobRecord | null> {
    const result = await this.database.query<JobRow>(
      `UPDATE tts_generation_jobs
       SET status = 'cancelled', updated_at = $2
       WHERE id = $1 AND status IN ('queued', 'running')
       RETURNING ${COLUMNS}`,
      [id, at.toISOString()],
    );
    return this.map(result.rows[0]);
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
