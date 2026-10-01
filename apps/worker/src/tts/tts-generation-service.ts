import { randomUUID } from 'node:crypto';

import {
  DEFAULT_TTS_AUDIO_LIMITS,
  TtsAudioInvalidError,
  validateSynthesizedAudio,
  type TtsAudioLimits,
} from './tts-audio-validation.js';
import {
  configHash,
  idempotencyKey,
  sha256Hex,
  transcriptHash,
} from './tts-hash.js';
import {
  TtsModelRegistryError,
  type TtsModelRegistry,
} from './tts-model-registry.js';
import {
  isTerminalTtsStatus,
  type TtsArtifact,
  type TtsJobRecord,
  type TtsJobRepository,
  type TtsModelRegistryEntry,
  type TtsProvider,
  type TtsSynthesisRequest,
  type TtsSynthesisResult,
} from './types.js';

export class TtsTimeoutError extends Error {
  readonly code = 'TTS_TIMEOUT';
  constructor() {
    super('tts synthesis timed out');
    this.name = 'TtsTimeoutError';
  }
}

export interface TtsGenerationRequest {
  narrationId: string;
  /** Reviewed transcript. Never logged or stored raw. */
  transcript: string;
  locale: string;
  config?: Record<string, string | number | boolean>;
  seed?: number | null;
}

export interface TtsGenerateOptions {
  maxAttempts?: number;
  timeoutMs?: number;
  baseBackoffMs?: number;
}

export interface TtsGenerationDeps {
  clock?: () => Date;
  sleep?: (ms: number) => Promise<void>;
  audioLimits?: TtsAudioLimits;
  newId?: () => string;
}

/**
 * Provider-neutral, idempotent, offline TTS pipeline.
 *
 * - Idempotent by `narrationId + transcriptHash + modelVersion`: a duplicate
 *   request never re-synthesizes and never duplicates an artifact.
 * - Retries with exponential backoff, per-attempt timeout and a terminal
 *   dead-letter after `maxAttempts`.
 * - Fail closed: a provider failure only marks the job; it never publishes and
 *   never touches an existing published narration.
 * - Privacy: only stable error codes are persisted — transcripts, prompts and
 *   audio bytes never enter the job record or logs.
 */
export class TtsGenerationService {
  private readonly clock: () => Date;
  private readonly sleep: (ms: number) => Promise<void>;
  private readonly audioLimits: TtsAudioLimits;
  private readonly newId: () => string;

  constructor(
    private readonly repository: TtsJobRepository,
    private readonly provider: TtsProvider,
    private readonly registry: TtsModelRegistry,
    deps: TtsGenerationDeps = {},
  ) {
    this.clock = deps.clock ?? (() => new Date());
    this.sleep =
      deps.sleep ??
      ((ms: number) => new Promise((resolve) => setTimeout(resolve, ms)));
    this.audioLimits = deps.audioLimits ?? DEFAULT_TTS_AUDIO_LIMITS;
    this.newId = deps.newId ?? (() => randomUUID());
  }

  async generate(
    request: TtsGenerationRequest,
    options: TtsGenerateOptions = {},
  ): Promise<TtsJobRecord> {
    const maxAttempts = positiveInteger(
      options.maxAttempts ?? 3,
      'maxAttempts',
    );
    const timeoutMs = positiveInteger(options.timeoutMs ?? 60_000, 'timeoutMs');
    const baseBackoffMs = nonNegativeInteger(
      options.baseBackoffMs ?? 500,
      'baseBackoffMs',
    );

    const entry = this.registry.requireForLocale(request.locale);
    this.assertProviderMatches(entry, request.locale);

    const tHash = transcriptHash(request.transcript);
    const key = idempotencyKey(
      request.narrationId,
      tHash,
      this.provider.modelVersion,
    );

    const existing = await this.repository.findByIdempotencyKey(key);
    if (existing && !this.isRetryable(existing)) {
      // Succeeded (artifact exists), in-flight, cancelled, or dead-lettered.
      return existing;
    }

    const config = request.config ?? {};
    const seed = request.seed ?? null;
    const record = existing ?? this.newRecord(request, tHash, key, maxAttempts);
    record.status = 'running';
    record.maxAttempts = maxAttempts;
    record.errorCode = null;
    record.deadLettered = false;
    record.updatedAt = this.clock();
    await this.repository.save(record);

    const synthesisRequest: TtsSynthesisRequest = {
      transcript: request.transcript,
      locale: request.locale,
      voiceId: entry.voiceId,
      config,
      seed,
    };

    let lastCode = 'TTS_PROVIDER_ERROR';
    for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
      record.attempts = attempt;
      try {
        const result = await this.withTimeout(
          this.provider.synthesize(synthesisRequest),
          timeoutMs,
        );
        validateSynthesizedAudio(result, this.audioLimits);
        record.artifact = this.buildArtifact(
          entry,
          result,
          config,
          tHash,
          seed,
        );
        record.status = 'succeeded';
        record.errorCode = null;
        record.updatedAt = this.clock();
        await this.repository.save(record);
        return record;
      } catch (error) {
        lastCode = errorCodeOf(error);
        record.errorCode = lastCode;
        record.updatedAt = this.clock();
        await this.repository.save(record);
        if (attempt < maxAttempts) {
          await this.sleep(baseBackoffMs * 2 ** (attempt - 1));
        }
      }
    }

    record.status = 'failed';
    record.deadLettered = true;
    record.errorCode = lastCode;
    record.updatedAt = this.clock();
    await this.repository.save(record);
    return record;
  }

  /** Cancel a non-terminal job. Terminal jobs are returned unchanged. */
  async cancel(jobId: string): Promise<TtsJobRecord | null> {
    const record = await this.repository.findById(jobId);
    if (!record) return null;
    if (isTerminalTtsStatus(record.status)) return record;
    record.status = 'cancelled';
    record.updatedAt = this.clock();
    await this.repository.save(record);
    return record;
  }

  private isRetryable(record: TtsJobRecord): boolean {
    return record.status === 'failed' && !record.deadLettered;
  }

  private newRecord(
    request: TtsGenerationRequest,
    tHash: string,
    key: string,
    maxAttempts: number,
  ): TtsJobRecord {
    const now = this.clock();
    return {
      id: this.newId(),
      narrationId: request.narrationId,
      status: 'queued',
      provider: this.provider.provider,
      model: this.provider.model,
      modelVersion: this.provider.modelVersion,
      transcriptHash: tHash,
      idempotencyKey: key,
      attempts: 0,
      maxAttempts,
      deadLettered: false,
      errorCode: null,
      artifact: null,
      createdAt: now,
      updatedAt: now,
    };
  }

  private assertProviderMatches(
    entry: TtsModelRegistryEntry,
    locale: string,
  ): void {
    if (
      !this.provider.supportsLocale(locale) ||
      this.provider.provider !== entry.provider ||
      this.provider.model !== entry.model ||
      this.provider.modelVersion !== entry.modelVersion
    ) {
      throw new TtsModelRegistryError(
        `provider ${this.provider.provider}/${this.provider.model} does not match the enabled voice for "${locale}"`,
      );
    }
  }

  private buildArtifact(
    entry: TtsModelRegistryEntry,
    result: TtsSynthesisResult,
    config: Record<string, string | number | boolean>,
    tHash: string,
    seed: number | null,
  ): TtsArtifact {
    return {
      provider: entry.provider,
      model: entry.model,
      modelVersion: entry.modelVersion,
      voiceId: entry.voiceId,
      license: entry.license,
      configHash: configHash(config),
      transcriptHash: tHash,
      seed,
      audioSha256: sha256Hex(result.audio),
      sizeBytes: result.audio.length,
      durationSeconds: result.durationSeconds,
      sampleRateHz: result.sampleRateHz,
      mimeType: 'audio/wav',
    };
  }

  private async withTimeout<T>(promise: Promise<T>, ms: number): Promise<T> {
    let timer: ReturnType<typeof setTimeout> | undefined;
    const timeout = new Promise<never>((_, reject) => {
      timer = setTimeout(() => reject(new TtsTimeoutError()), ms);
    });
    try {
      return await Promise.race([promise, timeout]);
    } finally {
      if (timer) clearTimeout(timer);
    }
  }
}

/** Map any failure to a stable code. Never returns transcript or provider text. */
function errorCodeOf(error: unknown): string {
  if (error instanceof TtsTimeoutError) return 'TTS_TIMEOUT';
  if (error instanceof TtsAudioInvalidError) return 'TTS_AUDIO_INVALID';
  if (
    typeof error === 'object' &&
    error !== null &&
    'code' in error &&
    typeof (error as { code: unknown }).code === 'string'
  ) {
    const code = (error as { code: string }).code;
    if (code.startsWith('TTS_')) return code;
  }
  return 'TTS_PROVIDER_ERROR';
}

function positiveInteger(value: number, name: string): number {
  if (!Number.isInteger(value) || value <= 0) {
    throw new Error(`${name} must be a positive integer`);
  }
  return value;
}

function nonNegativeInteger(value: number, name: string): number {
  if (!Number.isInteger(value) || value < 0) {
    throw new Error(`${name} must be a non-negative integer`);
  }
  return value;
}
