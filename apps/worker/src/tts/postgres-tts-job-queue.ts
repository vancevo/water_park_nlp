import type { SqlQueryClient } from './postgres-tts-job.repository.js';
import type {
  ClaimedTtsJob,
  DraftAudioAttachment,
  TtsCompletionOutcome,
  TtsJobQueue,
} from './tts-job-queue.js';
import type { TtsArtifact, TtsJobRecord, TtsJobStatus } from './types.js';

/** A pg `Pool` (or compatible): plain queries plus a dedicated client for a transaction. */
export interface SqlTransactionalPool extends SqlQueryClient {
  connect(): Promise<SqlQueryClient & { release(): void }>;
}

interface JobRow extends Record<string, unknown> {
  id: string;
  narration_id: string;
  status: TtsJobStatus;
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

interface NarrationRow extends Record<string, unknown> {
  id: string;
  poi_id: string;
  locale: string;
  transcript: string;
  workflow_status: string;
}

const COLUMNS = `id::text, narration_id::text, status, provider, model,
  model_version, transcript_hash, idempotency_key, attempts, max_attempts,
  dead_lettered, error_code, artifact, created_at, updated_at`;
const CLAIM_RETURNING = `j.id::text, j.narration_id::text, j.status, j.provider,
  j.model, j.model_version, j.transcript_hash, j.idempotency_key, j.attempts,
  j.max_attempts, j.dead_lettered, j.error_code, j.artifact, j.created_at,
  j.updated_at`;

export interface PostgresTtsJobQueueOptions {
  /**
   * A `running` job whose row was not updated for this long is considered
   * orphaned by a crashed worker and may be re-claimed. Must exceed the
   * per-attempt timeout (the worker heart-beats once per attempt).
   */
  staleRunningMs?: number;
  clock?: () => Date;
}

/**
 * Postgres {@link TtsJobQueue} over `tts_generation_jobs` + `poi_narrations`
 * (migrations 010 and 012). Claim uses `FOR UPDATE SKIP LOCKED`, so several
 * worker processes can poll the same table safely.
 */
export class PostgresTtsJobQueue implements TtsJobQueue {
  private readonly staleRunningMs: number;
  private readonly clock: () => Date;

  constructor(
    private readonly pool: SqlTransactionalPool,
    options: PostgresTtsJobQueueOptions = {},
  ) {
    this.staleRunningMs = options.staleRunningMs ?? 30 * 60_000;
    this.clock = options.clock ?? (() => new Date());
  }

  async claimNext(): Promise<ClaimedTtsJob | null> {
    const claimed = await this.pool.query<JobRow>(
      `WITH next AS (
         SELECT id FROM tts_generation_jobs
         WHERE status = 'queued'
            OR (status = 'running'
                AND updated_at < now() - make_interval(secs => $1::double precision / 1000))
         ORDER BY updated_at
         FOR UPDATE SKIP LOCKED
         LIMIT 1
       )
       UPDATE tts_generation_jobs j
       SET status = 'running', attempts = 0, error_code = NULL,
           dead_lettered = false, artifact = NULL, updated_at = $2
       FROM next WHERE j.id = next.id
       RETURNING ${CLAIM_RETURNING}`,
      [this.staleRunningMs, this.clock().toISOString()],
    );
    const job = mapJob(claimed.rows[0]);
    if (!job) return null;
    const narration = await this.pool.query<NarrationRow>(
      `SELECT id::text, poi_id::text, locale, transcript, workflow_status
       FROM poi_narrations WHERE id = $1`,
      [job.narrationId],
    );
    const row = narration.rows[0];
    if (!row) return null; // narration deleted → job row cascaded away
    return {
      job,
      narration: {
        id: row.id,
        poiId: row.poi_id,
        locale: row.locale,
        transcript: row.transcript,
        status: row.workflow_status,
      },
    };
  }

  async updateRunning(record: TtsJobRecord): Promise<boolean> {
    const result = await this.pool.query<{ id: string }>(
      `UPDATE tts_generation_jobs
       SET status = $2, attempts = $3, max_attempts = $4, dead_lettered = $5,
           error_code = $6, artifact = NULL, updated_at = $7
       WHERE id = $1 AND status = 'running'
       RETURNING id::text`,
      [
        record.id,
        record.status,
        record.attempts,
        record.maxAttempts,
        record.deadLettered,
        record.errorCode,
        record.updatedAt.toISOString(),
      ],
    );
    return result.rows.length === 1;
  }

  async completeWithDraftAudio(
    record: TtsJobRecord,
    attachment: DraftAudioAttachment,
    transcriptHashOf: (transcript: string) => string,
  ): Promise<TtsCompletionOutcome> {
    if (record.status !== 'succeeded' || record.artifact === null) {
      throw new Error('completeWithDraftAudio requires a succeeded record');
    }
    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');
      // Lock order: job row first, then the narration row.
      const job = await client.query<{ status: TtsJobStatus }>(
        'SELECT status FROM tts_generation_jobs WHERE id = $1 FOR UPDATE',
        [record.id],
      );
      if (job.rows[0]?.status !== 'running') {
        await client.query('ROLLBACK');
        return 'not_running';
      }
      const narration = await client.query<NarrationRow>(
        `SELECT id::text, poi_id::text, locale, transcript, workflow_status
         FROM poi_narrations WHERE id = $1 FOR UPDATE`,
        [record.narrationId],
      );
      const row = narration.rows[0];
      if (!row || row.workflow_status !== 'draft') {
        await client.query('ROLLBACK');
        return 'narration_not_draft';
      }
      if (transcriptHashOf(row.transcript) !== record.transcriptHash) {
        await client.query('ROLLBACK');
        return 'transcript_changed';
      }
      const at = record.updatedAt.toISOString();
      await client.query(
        `UPDATE tts_generation_jobs
         SET status = 'succeeded', attempts = $2, dead_lettered = false,
             error_code = NULL, artifact = $3::jsonb, updated_at = $4
         WHERE id = $1`,
        [record.id, record.attempts, JSON.stringify(record.artifact), at],
      );
      await client.query(
        `UPDATE poi_narrations
         SET audio_object_key = $2, audio_mime_type = $3, audio_size_bytes = $4,
             audio_sha256 = $5, audio_duration_seconds = $6, rights_owner = $7,
             rights_source = $8, usage_rights = $9,
             audio_generated_by = $10::jsonb, updated_at = $11
         WHERE id = $1 AND workflow_status = 'draft'`,
        [
          record.narrationId,
          attachment.objectKey,
          attachment.mimeType,
          attachment.sizeBytes,
          attachment.sha256,
          attachment.durationSeconds,
          attachment.rightsOwner,
          attachment.rightsSource,
          attachment.usageRights,
          JSON.stringify(attachment.generatedBy),
          at,
        ],
      );
      await client.query('COMMIT');
      return 'succeeded';
    } catch (error) {
      await client.query('ROLLBACK').catch(() => undefined);
      throw error;
    } finally {
      client.release();
    }
  }

  async findById(id: string): Promise<TtsJobRecord | null> {
    const result = await this.pool.query<JobRow>(
      `SELECT ${COLUMNS} FROM tts_generation_jobs WHERE id = $1`,
      [id],
    );
    return mapJob(result.rows[0]);
  }

  async countByStatus(): Promise<Partial<Record<TtsJobStatus, number>>> {
    const result = await this.pool.query<{
      status: TtsJobStatus;
      count: string | number;
    }>(
      `SELECT status, count(*) AS count FROM tts_generation_jobs
       WHERE status IN ('queued', 'running') GROUP BY status`,
    );
    const counts: Partial<Record<TtsJobStatus, number>> = {
      queued: 0,
      running: 0,
    };
    for (const row of result.rows) counts[row.status] = Number(row.count);
    return counts;
  }
}

function mapJob(row: JobRow | undefined): TtsJobRecord | null {
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
