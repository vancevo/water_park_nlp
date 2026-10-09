import type { AiFeatureFlags } from '../ops/ai-feature-flags.js';
import type { QuotaDecision, QuotaGuard } from '../ops/quota.js';
import type { TtsMetrics } from '../ops/tts-metrics.js';
import {
  DEFAULT_TTS_AUDIO_LIMITS,
  validateSynthesizedAudio,
  type TtsAudioLimits,
} from './tts-audio-validation.js';
import type { TtsAudioStore } from './tts-audio-store.js';
import {
  buildTtsArtifact,
  errorCodeOf,
  runWithTimeout,
} from './tts-generation-service.js';
import { transcriptHash } from './tts-hash.js';
import type {
  ClaimedTtsJob,
  DraftAudioAttachment,
  TtsJobQueue,
} from './tts-job-queue.js';
import type {
  TtsJobRecord,
  TtsModelRegistryEntry,
  TtsProvider,
} from './types.js';

/** One enabled voice and the provider instance that serves it. */
export interface TtsVoiceBinding {
  entry: TtsModelRegistryEntry;
  provider: TtsProvider;
}

export interface TtsJobRunnerConfig {
  /** Per-attempt synthesis timeout. */
  timeoutMs: number;
  /** Exponential backoff base between attempts. */
  baseBackoffMs: number;
  /** `rights_owner` written with generated draft audio. */
  rightsOwner: string;
}

export interface TtsJobRunnerDeps {
  clock?: () => Date;
  sleep?: (ms: number) => Promise<void>;
  audioLimits?: TtsAudioLimits;
  metrics?: TtsMetrics;
  log?: (line: string) => void;
}

/**
 * Stable job error codes the consumer adds on top of the provider codes
 * (`TTS_TIMEOUT`, `TTS_AUDIO_INVALID`, `TTS_PROVIDER_ERROR`, `TTS_STORAGE_ERROR`).
 */
export const TTS_JOB_PRECONDITION_CODES = {
  modelUnavailable: 'TTS_MODEL_UNAVAILABLE',
  narrationNotDraft: 'TTS_NARRATION_NOT_DRAFT',
  transcriptStale: 'TTS_TRANSCRIPT_STALE',
  /** Re-claimed after the stale window with every attempt already spent. */
  workerLost: 'TTS_WORKER_LOST',
} as const;

/**
 * Executes one claimed job (I02, ADR 0014): synthesize with retry/backoff and a
 * per-attempt timeout, validate, upload the audio to object storage, then mark
 * the job `succeeded` and attach the audio + AI provenance to the DRAFT
 * narration in one transaction. Never publishes and never touches a
 * non-draft narration. Every write is conditional on the job still being
 * `running` under this claim's lease token, so an API cancel always wins and
 * a superseded claim never writes. Logs carry ids, statuses and codes
 * only — never transcript text or audio bytes.
 */
export class TtsJobRunner {
  private readonly clock: () => Date;
  private readonly sleep: (ms: number) => Promise<void>;
  private readonly audioLimits: TtsAudioLimits;
  private readonly metrics?: TtsMetrics;
  private readonly log: (line: string) => void;

  constructor(
    private readonly queue: TtsJobQueue,
    private readonly audioStore: TtsAudioStore,
    private readonly voices: (locale: string) => TtsVoiceBinding | null,
    private readonly config: TtsJobRunnerConfig,
    deps: TtsJobRunnerDeps = {},
  ) {
    this.clock = deps.clock ?? (() => new Date());
    this.sleep =
      deps.sleep ??
      ((ms: number) => new Promise((resolve) => setTimeout(resolve, ms)));
    this.audioLimits = deps.audioLimits ?? DEFAULT_TTS_AUDIO_LIMITS;
    this.metrics = deps.metrics;
    this.log = deps.log ?? (() => undefined);
  }

  async process(claimed: ClaimedTtsJob): Promise<TtsJobRecord> {
    const job: TtsJobRecord = { ...claimed.job, artifact: null };
    const { narration, leaseToken } = claimed;
    const update = (record: TtsJobRecord) =>
      this.queue.updateRunning(record, leaseToken);
    this.metrics?.recordJobTransition('running', job);

    const binding = this.voices(narration.locale);
    if (
      !binding ||
      !binding.provider.supportsLocale(narration.locale) ||
      binding.entry.provider !== job.provider ||
      binding.entry.model !== job.model ||
      binding.entry.modelVersion !== job.modelVersion
    ) {
      // The API stamped a provider/model/version this worker does not serve
      // (I02-8): fail fast and visibly instead of leaving the job queued.
      return this.failNow(
        job,
        TTS_JOB_PRECONDITION_CODES.modelUnavailable,
        update,
      );
    }
    if (narration.status !== 'draft') {
      return this.failNow(
        job,
        TTS_JOB_PRECONDITION_CODES.narrationNotDraft,
        update,
      );
    }
    const tHash = transcriptHash(narration.transcript);
    if (tHash !== job.transcriptHash) {
      return this.failNow(
        job,
        TTS_JOB_PRECONDITION_CODES.transcriptStale,
        update,
      );
    }

    const startedAt = this.clock().getTime();
    // A stale re-claim continues after the attempts already spent, so a job
    // that keeps crashing workers is dead-lettered instead of looping.
    const firstAttempt = job.attempts + 1;
    let lastCode: string = TTS_JOB_PRECONDITION_CODES.workerLost;
    for (let attempt = firstAttempt; attempt <= job.maxAttempts; attempt += 1) {
      job.attempts = attempt;
      job.errorCode = null; // I02-10: never expose a previous attempt's code
      job.updatedAt = this.clock();
      if (!(await update(job))) return this.cancelled(job);

      let attachment: DraftAudioAttachment;
      let done: TtsJobRecord;
      try {
        const result = await runWithTimeout(
          (signal) =>
            binding.provider.synthesize({
              transcript: narration.transcript,
              locale: narration.locale,
              voiceId: binding.entry.voiceId,
              config: {},
              seed: null,
              signal,
            }),
          this.config.timeoutMs,
        );
        validateSynthesizedAudio(result, this.audioLimits);
        const artifact = buildTtsArtifact(
          binding.entry,
          result,
          {},
          tHash,
          null,
        );
        const objectKey = `poi/${narration.poiId}/${narration.locale}/${artifact.audioSha256}.wav`;

        // Heartbeat + cancel checkpoint before spending an upload.
        job.updatedAt = this.clock();
        if (!(await update(job))) return this.cancelled(job);

        await this.audioStore.put({
          objectKey,
          body: result.audio,
          mimeType: 'audio/wav',
          sha256: artifact.audioSha256,
        });
        const at = this.clock();
        done = {
          ...job,
          status: 'succeeded',
          errorCode: null,
          deadLettered: false,
          artifact: { ...artifact, objectKey },
          updatedAt: at,
        };
        attachment = {
          objectKey,
          mimeType: 'audio/wav',
          sizeBytes: artifact.sizeBytes,
          sha256: artifact.audioSha256,
          durationSeconds: artifact.durationSeconds,
          rightsOwner: this.config.rightsOwner,
          rightsSource: `AI-generated draft: ${artifact.provider}/${artifact.model}@${artifact.modelVersion} voice ${artifact.voiceId} (TTS job ${job.id})`,
          usageRights: `Voice license: ${artifact.license}. Draft only; requires human review before publish.`,
          generatedBy: {
            provider: artifact.provider,
            model: artifact.model,
            modelVersion: artifact.modelVersion,
            voiceId: artifact.voiceId,
            license: artifact.license,
            jobId: job.id,
            generatedAt: at.toISOString(),
          },
        };
      } catch (error) {
        lastCode = errorCodeOf(error);
        this.log(`tts job ${job.id}: attempt ${attempt} failed (${lastCode})`);
        if (attempt < job.maxAttempts) {
          this.metrics?.recordRetry(job);
          await this.sleep(this.config.baseBackoffMs * 2 ** (attempt - 1));
        }
        continue;
      }

      // Database errors here propagate: the row stays `running` and is
      // re-claimed after the stale window, never half-written.
      const outcome = await this.queue.completeWithDraftAudio(
        done,
        attachment,
        transcriptHash,
        leaseToken,
      );
      switch (outcome) {
        case 'succeeded':
          this.metrics?.recordJobTransition('succeeded', done);
          this.metrics?.recordGenerationDuration(
            this.clock().getTime() - startedAt,
            done,
          );
          this.log(
            `tts job ${done.id}: succeeded attempts=${done.attempts} attached to draft narration ${done.narrationId}`,
          );
          return done;
        case 'not_running':
          // Object stays unreferenced (content-addressed). ADR 0004 reserves
          // deletion for an audited lifecycle job, not implemented yet.
          return this.cancelled(job);
        case 'narration_not_draft':
          return this.failNow(
            job,
            TTS_JOB_PRECONDITION_CODES.narrationNotDraft,
            update,
          );
        case 'transcript_changed':
          return this.failNow(
            job,
            TTS_JOB_PRECONDITION_CODES.transcriptStale,
            update,
          );
      }
    }

    job.status = 'failed';
    job.deadLettered = true;
    job.errorCode = lastCode;
    job.updatedAt = this.clock();
    if (!(await update(job))) return this.cancelled(job);
    this.metrics?.recordJobTransition('failed', job);
    this.metrics?.recordDeadLetter(job);
    this.log(
      `tts job ${job.id}: failed ${lastCode} attempts=${job.attempts} dead-lettered`,
    );
    return job;
  }

  private async failNow(
    job: TtsJobRecord,
    code: string,
    update: (record: TtsJobRecord) => Promise<boolean>,
  ): Promise<TtsJobRecord> {
    job.status = 'failed';
    job.errorCode = code;
    job.deadLettered = false;
    job.updatedAt = this.clock();
    if (!(await update(job))) return this.cancelled(job);
    this.metrics?.recordJobTransition('failed', job);
    this.log(`tts job ${job.id}: failed ${code}`);
    return job;
  }

  private async cancelled(job: TtsJobRecord): Promise<TtsJobRecord> {
    const current = (await this.queue.findById(job.id)) ?? {
      ...job,
      status: 'cancelled',
    };
    this.metrics?.recordJobTransition(current.status, current);
    this.log(
      `tts job ${job.id}: no longer owned by this claim (now ${current.status}); result discarded`,
    );
    return current;
  }
}

export interface TtsJobConsumerOptions {
  /**
   * Read on every tick. The runtime passes `process.env`, so in practice the
   * kill switch takes effect on restart; a dynamic source would not need one.
   */
  flags: () => AiFeatureFlags;
  quota: QuotaGuard;
  /** Quota key (one per worker pool). */
  quotaKey?: string;
  pollIntervalMs?: number;
  metrics?: TtsMetrics;
  log?: (line: string) => void;
  sleep?: (ms: number) => Promise<void>;
  now?: () => number;
}

export type TtsConsumerTick =
  | { state: 'disabled' }
  | {
      state: 'throttled';
      reason: Extract<QuotaDecision, { allowed: false }>['reason'];
    }
  | { state: 'idle' }
  | { state: 'started'; jobId: string; done: Promise<TtsJobRecord> };

/**
 * Polling consumer: one sequential dispatcher claims jobs while the AI08 kill
 * switch is on and the {@link QuotaGuard} admits work (rate per window +
 * concurrency cap), then runs each claimed job concurrently.
 */
export class TtsJobConsumer {
  private readonly quotaKey: string;
  private readonly pollIntervalMs: number;
  private readonly log: (line: string) => void;
  private readonly sleep: (ms: number) => Promise<void>;
  private readonly now: () => number;
  private readonly inFlight = new Set<Promise<unknown>>();
  private running = false;
  private loop?: Promise<void>;
  private lastDisabledLog = false;
  private lastDepthAt = Number.NEGATIVE_INFINITY;

  constructor(
    private readonly queue: TtsJobQueue,
    private readonly runner: TtsJobRunner,
    private readonly options: TtsJobConsumerOptions,
  ) {
    this.quotaKey = options.quotaKey ?? 'tts-worker';
    this.pollIntervalMs = options.pollIntervalMs ?? 1000;
    this.log = options.log ?? (() => undefined);
    this.sleep =
      options.sleep ??
      ((ms: number) => new Promise((resolve) => setTimeout(resolve, ms)));
    this.now = options.now ?? (() => Date.now());
  }

  /** Claim and start at most one job. Exposed for tests and one-shot runs. */
  async tick(): Promise<TtsConsumerTick> {
    if (!this.options.flags().ttsGenerationEnabled) {
      if (!this.lastDisabledLog)
        this.log(
          'tts consumer: TTS_GENERATION_ENABLED=false — not claiming jobs',
        );
      this.lastDisabledLog = true;
      return { state: 'disabled' };
    }
    this.lastDisabledLog = false;
    const decision = this.options.quota.peek(this.quotaKey, this.now());
    if (!decision.allowed)
      return { state: 'throttled', reason: decision.reason };

    const claimed = await this.queue.claimNext();
    if (!claimed) return { state: 'idle' };
    // Safe: this dispatcher is the only acquirer and peek() just allowed it.
    this.options.quota.tryAcquire(this.quotaKey, this.now());
    this.log(
      `tts job ${claimed.job.id}: claimed (${claimed.narration.locale})`,
    );
    const done = this.runner
      .process(claimed)
      .finally(() => this.options.quota.release(this.quotaKey));
    const tracked = done.catch((error: unknown) => {
      this.log(
        `tts job ${claimed.job.id}: worker error ${(error as { code?: string }).code ?? (error as Error).name}; job left running for stale re-claim`,
      );
    });
    this.inFlight.add(tracked);
    void tracked.finally(() => this.inFlight.delete(tracked));
    return { state: 'started', jobId: claimed.job.id, done };
  }

  start(): void {
    if (this.running) return;
    this.running = true;
    this.loop = (async () => {
      while (this.running) {
        let state: TtsConsumerTick['state'] = 'idle';
        try {
          state = (await this.tick()).state;
          if (this.options.metrics) await this.recordDepth();
        } catch (error) {
          this.log(
            `tts consumer: tick error ${(error as { code?: string }).code ?? (error as Error).name}`,
          );
        }
        // Keep claiming while there is work and capacity; otherwise back off.
        if (state !== 'started') await this.sleep(this.pollIntervalMs);
      }
    })();
  }

  /** Stop claiming; wait for in-flight jobs to finish. */
  async stop(): Promise<void> {
    this.running = false;
    await this.loop;
    await Promise.allSettled([...this.inFlight]);
  }

  get activeJobs(): number {
    return this.inFlight.size;
  }

  private async recordDepth(): Promise<void> {
    if (this.now() - this.lastDepthAt < 15_000) return;
    this.lastDepthAt = this.now();
    const counts = await this.queue.countByStatus();
    this.options.metrics?.setQueueDepth(counts.queued ?? 0, {
      status: 'queued',
    });
    this.options.metrics?.setQueueDepth(counts.running ?? 0, {
      status: 'running',
    });
  }
}
