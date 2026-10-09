import { randomUUID } from 'node:crypto';

import {
  BadRequestException,
  ConflictException,
  Inject,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import type {
  LatestTtsJobResponse,
  TtsGenerationJob,
} from '@damsen/shared-types';

import {
  NARRATION_REPOSITORY,
  type NarrationRecord,
  type NarrationRepository,
} from './narration.models.js';
import { NarrationLocalesService } from './narration-locales.service.js';
import type { CreateTtsJobDto } from './tts-job.dto.js';
import {
  TTS_JOB_CONTROLS,
  TtsJobInProgressException,
  type TtsJobControls,
} from './tts-job-controls.js';
import { idempotencyKey, transcriptHash } from './tts-hash.js';
import {
  isTerminalTtsStatus,
  TTS_JOB_CLOCK,
  TTS_JOB_DEFAULTS,
  TTS_JOB_REPOSITORY,
  type TtsJobDefaults,
  type TtsJobRecord,
  type TtsJobRepository,
  type TtsVoiceDefaults,
} from './tts-job.models.js';

/**
 * Admin-only orchestration for TTS generation jobs (AI04, I02).
 *
 * The API *enqueues* work and never synthesizes: a successful request writes a
 * `queued` row and returns it for polling. The worker claims it, synthesizes,
 * stores the audio and attaches it to the DRAFT narration (never publishes).
 *
 * Boundaries enforced here: AI08 kill switch (503) and quota (429); the
 * narration must exist (404) and be a `draft` (409 `NARRATION_NOT_DRAFT`); the
 * locale must be enabled and equal to the narration locale; the transcript must
 * be non-empty; the provider/model must match the voice the worker serves
 * (400 `TTS_VOICE_UNAVAILABLE`); only one queued/running job per narration
 * (409 `TTS_JOB_IN_PROGRESS`). Enqueue is idempotent by narration + transcript
 * + model version; a failed/cancelled job re-enqueues in place.
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
    @Inject(TTS_JOB_CONTROLS) private readonly controls: TtsJobControls,
  ) {}

  async create(
    narrationId: string,
    input: CreateTtsJobDto,
    actorId = 'anonymous',
  ): Promise<TtsGenerationJob> {
    this.controls.assertEnabled();

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

    if (narration.status !== 'draft') {
      throw new ConflictException({
        code: 'NARRATION_NOT_DRAFT',
        message: 'TTS audio can only be generated for a draft narration',
        details: { status: narration.status },
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

    const { provider, model, modelVersion } = this.voiceFor(
      narration.locale,
      input,
    );
    const tHash = transcriptHash(transcript);
    const key = idempotencyKey(narrationId, tHash, modelVersion);

    const existing = await this.jobs.findByIdempotencyKey(key);
    if (
      existing &&
      (!isTerminalTtsStatus(existing.status) ||
        (existing.status === 'succeeded' &&
          this.draftStillHasAudioOf(narration, existing)))
    ) {
      // Queued/running, or succeeded and its audio is still the draft's
      // current audio → idempotent, return as-is.
      return this.toPublic(existing);
    }

    // From here on a job is (re-)enqueued.
    if (await this.jobs.hasActiveForNarration(narrationId)) {
      throw new TtsJobInProgressException();
    }
    this.controls.assertBacklog(await this.jobs.countActive());
    this.controls.consume(actorId);

    if (existing) {
      // Failed or cancelled, or succeeded but the editor has since replaced
      // that audio (e.g. transcript A → B → A) → re-enqueue the same row, so
      // a "succeeded" answer always means "this audio is on the draft".
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
        artifact: null,
        updatedAt: this.now(),
      };
      if (await this.jobs.requeue(reenqueued)) return this.toPublic(reenqueued);
      // Lost a race (someone else re-enqueued it): return the current row.
      return this.get(existing.id);
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
      artifact: null,
      createdAt: at,
      updatedAt: at,
    };
    try {
      await this.jobs.insert(record);
    } catch (error) {
      // Concurrent identical request inserted first → idempotent answer.
      const winner = await this.jobs.findByIdempotencyKey(key);
      if (winner) return this.toPublic(winner);
      throw error;
    }
    return this.toPublic(record);
  }

  async get(jobId: string): Promise<TtsGenerationJob> {
    return this.toPublic(await this.require(jobId));
  }

  /** Latest job of a narration (`{ job: null }` when it never had one). */
  async latest(narrationId: string): Promise<LatestTtsJobResponse> {
    if (!(await this.narrations.findById(narrationId))) {
      throw new NotFoundException('Narration not found');
    }
    const job = await this.jobs.findLatestByNarration(narrationId);
    return { job: job ? this.toPublic(job) : null };
  }

  /**
   * Cancel a queued/running job with a conditional write, so it never
   * overwrites a result the worker committed meanwhile. Terminal jobs are
   * returned unchanged (idempotent).
   */
  async cancel(jobId: string): Promise<TtsGenerationJob> {
    const cancelled = await this.jobs.cancelIfActive(jobId, this.now());
    if (cancelled) return this.toPublic(cancelled);
    return this.toPublic(await this.require(jobId));
  }

  /** True when the narration's current audio is the job's generated audio. */
  private draftStillHasAudioOf(
    narration: NarrationRecord,
    job: TtsJobRecord,
  ): boolean {
    return (
      narration.audio !== null &&
      job.artifact != null &&
      narration.audio.sha256 === job.artifact.audioSha256 &&
      narration.audioGeneratedBy?.jobId === job.id
    );
  }

  private voiceFor(locale: string, input: CreateTtsJobDto): TtsVoiceDefaults {
    const voices = this.defaults.voices;
    if (!voices) {
      return {
        provider: input.provider ?? this.defaults.provider,
        model: input.model ?? this.defaults.model,
        modelVersion: this.defaults.modelVersion,
      };
    }
    const voice = voices[locale];
    if (
      !voice ||
      (input.provider !== undefined && input.provider !== voice.provider) ||
      (input.model !== undefined && input.model !== voice.model)
    ) {
      throw new BadRequestException({
        code: 'TTS_VOICE_UNAVAILABLE',
        message: 'No enabled TTS voice serves this locale/provider/model',
        details: null,
      });
    }
    return voice;
  }

  private async require(jobId: string): Promise<TtsJobRecord> {
    const record = await this.jobs.findById(jobId);
    if (!record) throw new NotFoundException('TTS job not found');
    return record;
  }

  private toPublic(record: TtsJobRecord): TtsGenerationJob {
    const artifact = record.status === 'succeeded' ? record.artifact : null;
    return {
      id: record.id,
      narrationId: record.narrationId,
      status: record.status,
      provider: record.provider,
      model: record.model,
      modelVersion: record.modelVersion,
      createdAt: record.createdAt.toISOString(),
      updatedAt: record.updatedAt.toISOString(),
      // v1.1: an errorCode is only meaningful on a failed job (I02-10).
      ...(record.status === 'failed' && record.errorCode
        ? { errorCode: record.errorCode }
        : {}),
      ...(artifact
        ? {
            artifact: {
              voiceId: artifact.voiceId,
              license: artifact.license,
              audioSha256: artifact.audioSha256,
              sizeBytes: artifact.sizeBytes,
              durationSeconds: artifact.durationSeconds,
              sampleRateHz: artifact.sampleRateHz,
              mimeType: artifact.mimeType,
            },
          }
        : {}),
    };
  }
}
