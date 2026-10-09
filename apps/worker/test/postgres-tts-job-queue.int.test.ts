import { randomUUID } from 'node:crypto';
import { createRequire } from 'node:module';

import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import {
  PostgresTtsJobQueue,
  type SqlTransactionalPool,
} from '../src/tts/postgres-tts-job-queue.js';
import { idempotencyKey, transcriptHash } from '../src/tts/tts-hash.js';
import type { DraftAudioAttachment } from '../src/tts/tts-job-queue.js';
import type { TtsJobRecord } from '../src/tts/types.js';

/**
 * Real-Postgres checks for the I02 claim/cancel/attach semantics. Opt-in:
 * set TTS_QUEUE_TEST_DATABASE_URL to a disposable database with migrations
 * 001–012 applied (it inserts and deletes its own narration/job rows).
 */
const url = process.env.TTS_QUEUE_TEST_DATABASE_URL;

const TRANSCRIPT = 'Integration transcript for the TTS queue consumer test.';
const SHA = 'b'.repeat(64);

describe.skipIf(!url)('PostgresTtsJobQueue (real database)', () => {
  type Pool = SqlTransactionalPool & { end(): Promise<void> };
  let pool: Pool;
  let queue: PostgresTtsJobQueue;
  let poiId: string;
  const narrations: string[] = [];

  beforeAll(async () => {
    const require = createRequire(import.meta.url);
    const pg = require('pg') as {
      Pool: new (options: { connectionString: string }) => Pool;
    };
    pool = new pg.Pool({ connectionString: url! });
    queue = new PostgresTtsJobQueue(pool);
    const poi = await pool.query<{ id: string }>(
      'SELECT id::text FROM pois ORDER BY id LIMIT 1',
    );
    poiId = poi.rows[0]!.id;
  });

  afterAll(async () => {
    if (narrations.length)
      await pool.query(
        'DELETE FROM poi_narrations WHERE id = ANY($1::uuid[])',
        [narrations],
      );
    await pool.end();
  });

  async function draft(status = 'draft'): Promise<string> {
    const id = randomUUID();
    narrations.push(id);
    await pool.query(
      `INSERT INTO poi_narrations (id, poi_id, locale, revision, transcript, workflow_status)
       VALUES ($1, $2, 'vi', 1000 + floor(random() * 1000000)::int, $3, $4)`,
      [id, poiId, TRANSCRIPT, status],
    );
    return id;
  }

  async function enqueue(narrationId: string): Promise<string> {
    const id = randomUUID();
    const tHash = transcriptHash(TRANSCRIPT);
    await pool.query(
      `INSERT INTO tts_generation_jobs (id, narration_id, status, provider, model,
         model_version, transcript_hash, idempotency_key, attempts, max_attempts,
         dead_lettered, error_code, created_at, updated_at)
       VALUES ($1, $2, 'queued', 'e2e', 'tone', 'v1', $3, $4, 0, 3, false,
         'TTS_TIMEOUT', now() - interval '1 day', now() - interval '1 day')`,
      [id, narrationId, tHash, idempotencyKey(narrationId, tHash, 'v1')],
    );
    return id;
  }

  function attachment(job: TtsJobRecord): DraftAudioAttachment {
    return {
      objectKey: `poi/${poiId}/vi/${SHA}.wav`,
      mimeType: 'audio/wav',
      sizeBytes: 64,
      sha256: SHA,
      durationSeconds: 2,
      rightsOwner: 'Project (AI draft)',
      rightsSource: 'AI-generated draft',
      usageRights: 'Draft only',
      generatedBy: {
        provider: 'e2e',
        model: 'tone',
        modelVersion: 'v1',
        voiceId: 'tone-vi',
        license: 'test',
        jobId: job.id,
        generatedAt: new Date().toISOString(),
      },
    };
  }

  function succeeded(job: TtsJobRecord): TtsJobRecord {
    return {
      ...job,
      status: 'succeeded',
      attempts: 1,
      updatedAt: new Date(),
      artifact: {
        provider: 'e2e',
        model: 'tone',
        modelVersion: 'v1',
        voiceId: 'tone-vi',
        license: 'test',
        configHash: 'c'.repeat(64),
        transcriptHash: job.transcriptHash,
        seed: null,
        audioSha256: SHA,
        sizeBytes: 64,
        durationSeconds: 2,
        sampleRateHz: 22_050,
        mimeType: 'audio/wav',
        objectKey: `poi/${poiId}/vi/${SHA}.wav`,
      },
    };
  }

  it('claims atomically: concurrent claimers get the job exactly once, errorCode cleared', async () => {
    const jobId = await enqueue(await draft());
    const claims = await Promise.all(
      Array.from({ length: 6 }, () => queue.claimNext()),
    );
    const mine = claims.filter((c) => c?.job.id === jobId);
    expect(mine).toHaveLength(1);
    expect(mine[0]!.job).toMatchObject({
      status: 'running',
      attempts: 0,
      errorCode: null,
    });
    expect(mine[0]!.narration.transcript).toBe(TRANSCRIPT);
  });

  it('cancel while running wins over progress and completion', async () => {
    const narrationId = await draft();
    const jobId = await enqueue(narrationId);
    let claimed = await queue.claimNext();
    while (claimed && claimed.job.id !== jobId)
      claimed = await queue.claimNext();
    const job = claimed!.job;
    expect(await queue.updateRunning({ ...job, attempts: 1 })).toBe(true);

    // What the API cancel does: conditional on queued/running.
    await pool.query(
      `UPDATE tts_generation_jobs SET status = 'cancelled' WHERE id = $1
         AND status IN ('queued', 'running')`,
      [jobId],
    );
    expect(await queue.updateRunning({ ...job, attempts: 2 })).toBe(false);
    expect(
      await queue.completeWithDraftAudio(
        succeeded(job),
        attachment(job),
        transcriptHash,
      ),
    ).toBe('not_running');
    const row = await pool.query<{ status: string; artifact: unknown }>(
      'SELECT status, artifact FROM tts_generation_jobs WHERE id = $1',
      [jobId],
    );
    expect(row.rows[0]).toEqual({ status: 'cancelled', artifact: null });
    const n = await pool.query<{ audio_object_key: string | null }>(
      'SELECT audio_object_key FROM poi_narrations WHERE id = $1',
      [narrationId],
    );
    expect(n.rows[0]!.audio_object_key).toBeNull();
  });

  it('completes atomically: job succeeded + audio and provenance on the draft', async () => {
    const narrationId = await draft();
    const jobId = await enqueue(narrationId);
    let claimed = await queue.claimNext();
    while (claimed && claimed.job.id !== jobId)
      claimed = await queue.claimNext();
    const job = claimed!.job;
    expect(
      await queue.completeWithDraftAudio(
        succeeded(job),
        attachment(job),
        transcriptHash,
      ),
    ).toBe('succeeded');
    const n = await pool.query<{
      workflow_status: string;
      audio_object_key: string;
      audio_generated_by: { jobId: string };
    }>(
      `SELECT workflow_status, audio_object_key, audio_generated_by
       FROM poi_narrations WHERE id = $1`,
      [narrationId],
    );
    expect(n.rows[0]).toMatchObject({
      workflow_status: 'draft',
      audio_object_key: `poi/${poiId}/vi/${SHA}.wav`,
      audio_generated_by: { jobId },
    });
    expect((await queue.findById(jobId))?.status).toBe('succeeded');
  });

  it('never attaches to a non-draft narration', async () => {
    const narrationId = await draft();
    const jobId = await enqueue(narrationId);
    let claimed = await queue.claimNext();
    while (claimed && claimed.job.id !== jobId)
      claimed = await queue.claimNext();
    await pool.query(
      `UPDATE poi_narrations SET workflow_status = 'rejected' WHERE id = $1`,
      [narrationId],
    );
    const job = claimed!.job;
    expect(
      await queue.completeWithDraftAudio(
        succeeded(job),
        attachment(job),
        transcriptHash,
      ),
    ).toBe('narration_not_draft');
    expect((await queue.findById(jobId))?.status).toBe('running');
  });

  it('re-claims a running job orphaned past the stale window', async () => {
    const jobId = await enqueue(await draft());
    await pool.query(
      `UPDATE tts_generation_jobs SET status = 'running',
         updated_at = now() - interval '2 hours' WHERE id = $1`,
      [jobId],
    );
    const fast = new PostgresTtsJobQueue(pool, { staleRunningMs: 60_000 });
    let claimed = await fast.claimNext();
    while (claimed && claimed.job.id !== jobId)
      claimed = await fast.claimNext();
    expect(claimed?.job.status).toBe('running');
  });
});
