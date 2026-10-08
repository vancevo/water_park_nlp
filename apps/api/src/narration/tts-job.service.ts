import { randomUUID } from 'node:crypto';

import {
  BadRequestException,
  Inject,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import type { TtsGenerationJob } from '@damsen/shared-types';

import {
  NARRATION_REPOSITORY,
  type NarrationRepository,
} from './narration.models.js';
import { NarrationLocalesService } from './narration-locales.service.js';
import type { CreateTtsJobDto } from './tts-job.dto.js';
import { idempotencyKey, transcriptHash } from './tts-hash.js';
import {
  isTerminalTtsStatus,
  TTS_JOB_CLOCK,
  TTS_JOB_DEFAULTS,
  TTS_JOB_REPOSITORY,
  type TtsJobDefaults,
  type TtsJobRecord,
  type TtsJobRepository,
} from './tts-job.models.js';

/**
 * Admin-only orchestration for TTS generation jobs (AI04).
 *
 * The API *enqueues* work and never synthesizes: a successful request writes a
 * `queued` row (output is a draft artifact only — a job never publishes a
 * narration) and returns it for polling. The worker (C03/AI02 + Piper C04/AI03)
 * runs, retries and dead-letters the job out of band.
 *
 * Boundaries enforced here: the narration must exist, the requested locale must
 * be an enabled catalog locale and must match the narration's own locale, and
 * the transcript must be non-empty. RBAC (EDITOR/ADMIN for write, no VISITOR) is
 * enforced by the controller guards. Enqueue is idempotent by
 * narration + transcript + model version; a terminal job re-enqueues in place.
 */
@Injectable()
export class AdminTtsJobService {
  constructor(
    @Inject(TTS_JOB_REPOSITORY) private readonly jobs: TtsJobRepository,
    @Inject(NARRATION_REPOSITORY)
    private readonly narrations: NarrationRepository,
    @Inject(NarrationLocalesService)
    private readonly locales: NarrationLocalesService,
    @Inject(TTS_JOB_CLOCK) private readonly now: () => Date,
    @Inject(TTS_JOB_DEFAULTS) private readonly defaults: TtsJobDefaults,
  ) {}

  async create(
    narrationId: string,
    input: CreateTtsJobDto,
  ): Promise<TtsGenerationJob> {
    const narration = await this.narrations.findById(narrationId);
    if (!narration) throw new NotFoundException('Narration not found');

    const locale = this.locales.requireEnabled(input.locale);
    if (locale.toLowerCase() !== narration.locale.toLowerCase()) {
      throw new BadRequestException({
        code: 'TTS_JOB_LOCALE_MISMATCH',
        message: `Requested locale "${input.locale}" does not match the narration locale "${narration.locale}"`,
        details: null,
      });
    }

    const transcript = narration.transcript?.trim() ?? '';
    if (transcript.length === 0) {
      throw new BadRequestException({
        code: 'TTS_JOB_TRANSCRIPT_EMPTY',
        message: 'Narration has no transcript to synthesize',
        details: null,
      });
    }

    const provider = input.provider ?? this.defaults.provider;
    const model = input.model ?? this.defaults.model;
    const modelVersion = this.defaults.modelVersion;
    const tHash = transcriptHash(transcript);
    const key = idempotencyKey(narrationId, tHash, modelVersion);

    const existing = await this.jobs.findByIdempotencyKey(key);
    if (existing) {
      // Already queued, running or succeeded → idempotent, return as-is.
      if (
        existing.status === 'succeeded' ||
        !isTerminalTtsStatus(existing.status)
      ) {
        return this.toPublic(existing);
      }
      // Previously failed or cancelled → re-enqueue the same row.
      const reenqueued: TtsJobRecord = {
        ...existing,
        status: 'queued',
        provider,
        model,
        modelVersion,
        attempts: 0,
        maxAttempts: this.defaults.maxAttempts,
        deadLettered: false,
        errorCode: null,
        updatedAt: this.now(),
      };
      await this.jobs.save(reenqueued);
      return this.toPublic(reenqueued);
    }

    const at = this.now();
    const record: TtsJobRecord = {
      id: randomUUID(),
      narrationId,
      status: 'queued',
      provider,
      model,
      modelVersion,
      transcriptHash: tHash,
      idempotencyKey: key,
      attempts: 0,
      maxAttempts: this.defaults.maxAttempts,
      deadLettered: false,
      errorCode: null,
      createdAt: at,
      updatedAt: at,
    };
    await this.jobs.insert(record);
    return this.toPublic(record);
  }

  async get(jobId: string): Promise<TtsGenerationJob> {
    return this.toPublic(await this.require(jobId));
  }

  /** Cancel a non-terminal job. Terminal jobs are returned unchanged (idempotent). */
  async cancel(jobId: string): Promise<TtsGenerationJob> {
    const record = await this.require(jobId);
    if (isTerminalTtsStatus(record.status)) return this.toPublic(record);
    record.status = 'cancelled';
    record.updatedAt = this.now();
    await this.jobs.save(record);
    return this.toPublic(record);
  }

  private async require(jobId: string): Promise<TtsJobRecord> {
    const record = await this.jobs.findById(jobId);
    if (!record) throw new NotFoundException('TTS job not found');
    return record;
  }

  private toPublic(record: TtsJobRecord): TtsGenerationJob {
    return {
      id: record.id,
      narrationId: record.narrationId,
      status: record.status,
      provider: record.provider,
      model: record.model,
      modelVersion: record.modelVersion,
      createdAt: record.createdAt.toISOString(),
      updatedAt: record.updatedAt.toISOString(),
      ...(record.errorCode ? { errorCode: record.errorCode } : {}),
    };
  }
}
