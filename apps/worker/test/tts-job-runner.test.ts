import { describe, expect, it } from 'vitest';

import { MetricsRegistry } from '../src/ops/metrics.js';
import { QuotaGuard } from '../src/ops/quota.js';
import { TtsMetrics } from '../src/ops/tts-metrics.js';
import { InMemoryTtsJobQueue } from '../src/tts/in-memory-tts-job-queue.js';
import { InMemoryTtsAudioStore } from '../src/tts/tts-audio-store.js';
import { idempotencyKey, transcriptHash } from '../src/tts/tts-hash.js';
import type { TtsNarrationSnapshot } from '../src/tts/tts-job-queue.js';
import {
  TtsJobConsumer,
  TtsJobRunner,
  type TtsVoiceBinding,
} from '../src/tts/tts-job-runner.js';
import type {
  TtsJobRecord,
  TtsModelRegistryEntry,
  TtsProvider,
  TtsSynthesisRequest,
  TtsSynthesisResult,
} from '../src/tts/types.js';

const NARRATION_ID = '00000000-0000-4000-8000-000000000301';
const POI_ID = '00000000-0000-4000-8000-000000000101';
const TRANSCRIPT = 'Bản thuyết minh tiếng Việt đã được duyệt cho khu vui chơi.';
const AT = new Date('2026-10-09T00:00:00.000Z');

const ENTRY: TtsModelRegistryEntry = {
  provider: 'piper',
  model: 'vi_VN-test',
  modelVersion: '2026.01.0',
  voiceId: 'vi_VN-test-medium',
  locale: 'vi',
  license: 'MIT',
  sourceUrl: 'https://example.test/model',
  checksum: 'a'.repeat(64),
  enabled: true,
};

function wav(): Uint8Array {
  const buffer = new Uint8Array(64);
  buffer.set([0x52, 0x49, 0x46, 0x46], 0);
  buffer.set([0x57, 0x41, 0x56, 0x45], 8);
  return buffer;
}

/** Scripted provider; `gate` lets a test act while synthesis is in flight. */
class ScriptedProvider implements TtsProvider {
  readonly provider = ENTRY.provider;
  readonly model = ENTRY.model;
  readonly modelVersion = ENTRY.modelVersion;
  calls = 0;
  requests: TtsSynthesisRequest[] = [];
  constructor(
    private readonly script: Array<'ok' | 'fail' | 'bad'> = ['ok'],
    private readonly gate?: (call: number) => Promise<void>,
  ) {}
  supportsLocale(locale: string): boolean {
    return locale === 'vi';
  }
  async synthesize(request: TtsSynthesisRequest): Promise<TtsSynthesisResult> {
    this.calls += 1;
    this.requests.push(request);
    if (this.gate) await this.gate(this.calls);
    const step = this.script[Math.min(this.calls, this.script.length) - 1];
    if (step === 'fail') throw new Error('provider failed: secret transcript');
    const audio = step === 'bad' ? new Uint8Array([1, 2, 3]) : wav();
    return {
      audio,
      mimeType: 'audio/wav',
      durationSeconds: 2,
      sampleRateHz: 22_050,
    };
  }
}

function narration(
  overrides: Partial<TtsNarrationSnapshot> = {},
): TtsNarrationSnapshot {
  return {
    id: NARRATION_ID,
    poiId: POI_ID,
    locale: 'vi',
    transcript: TRANSCRIPT,
    status: 'draft',
    ...overrides,
  };
}

function queuedJob(overrides: Partial<TtsJobRecord> = {}): TtsJobRecord {
  const tHash = transcriptHash(TRANSCRIPT);
  return {
    id: 'job-1',
    narrationId: NARRATION_ID,
    status: 'queued',
    provider: ENTRY.provider,
    model: ENTRY.model,
    modelVersion: ENTRY.modelVersion,
    transcriptHash: tHash,
    idempotencyKey: idempotencyKey(NARRATION_ID, tHash, ENTRY.modelVersion),
    attempts: 0,
    maxAttempts: 3,
    deadLettered: false,
    // A previous run's code (I02-10): must not survive into `running`.
    errorCode: null,
    artifact: null,
    createdAt: AT,
    updatedAt: AT,
    ...overrides,
  };
}

function setup(
  options: {
    provider?: ScriptedProvider;
    job?: Partial<TtsJobRecord>;
    narration?: Partial<TtsNarrationSnapshot>;
    binding?: TtsVoiceBinding | null;
    sleep?: (ms: number) => Promise<void>;
  } = {},
) {
  const queue = new InMemoryTtsJobQueue(
    {
      jobs: [queuedJob(options.job)],
      narrations: [narration(options.narration)],
    },
    () => AT,
  );
  const store = new InMemoryTtsAudioStore();
  const provider = options.provider ?? new ScriptedProvider();
  const registry = new MetricsRegistry();
  const binding =
    options.binding === undefined
      ? { entry: ENTRY, provider }
      : options.binding;
  const runner = new TtsJobRunner(
    queue,
    store,
    () => binding,
    { timeoutMs: 1000, baseBackoffMs: 0, rightsOwner: 'Project (AI draft)' },
    {
      clock: () => AT,
      sleep: options.sleep ?? (async () => {}),
      metrics: new TtsMetrics(registry),
    },
  );
  return { queue, store, provider, runner, registry };
}

async function runOne(ctx: ReturnType<typeof setup>): Promise<TtsJobRecord> {
  const claimed = await ctx.queue.claimNext();
  expect(claimed).not.toBeNull();
  return ctx.runner.process(claimed!);
}

describe('TtsJobRunner (I02 queue consumer)', () => {
  it('runs an API-created queued job, stores audio and attaches it to the draft with provenance', async () => {
    const ctx = setup();
    const job = await runOne(ctx);

    expect(job.status).toBe('succeeded');
    expect(job.errorCode).toBeNull();
    const sha = job.artifact!.audioSha256;
    const key = `poi/${POI_ID}/vi/${sha}.wav`;
    expect(job.artifact!.objectKey).toBe(key);
    expect(ctx.store.objects.get(key)?.sha256).toBe(sha);

    const audio = ctx.queue.attachedAudio(NARRATION_ID)!;
    expect(audio).toMatchObject({
      objectKey: key,
      mimeType: 'audio/wav',
      sha256: sha,
      sizeBytes: 64,
      durationSeconds: 2,
      rightsOwner: 'Project (AI draft)',
      generatedBy: {
        provider: 'piper',
        model: 'vi_VN-test',
        modelVersion: '2026.01.0',
        voiceId: 'vi_VN-test-medium',
        license: 'MIT',
        jobId: 'job-1',
      },
    });
    expect(audio.usageRights).toContain('MIT');
    // Privacy: no transcript in anything persisted.
    expect(JSON.stringify({ job, audio })).not.toContain(TRANSCRIPT);
    expect(ctx.registry.toPrometheus()).toContain('status="succeeded"');
  });

  it('a cancel while synthesizing wins: result discarded, nothing attached (I02-2)', async () => {
    const box = {} as { ctx: ReturnType<typeof setup> };
    const provider = new ScriptedProvider(['ok'], async () => {
      box.ctx.queue.cancel('job-1');
    });
    box.ctx = setup({ provider });
    const job = await runOne(box.ctx);

    expect(job.status).toBe('cancelled');
    expect((await box.ctx.queue.findById('job-1'))?.status).toBe('cancelled');
    expect(box.ctx.queue.attachedAudio(NARRATION_ID)).toBeNull();
    expect(box.ctx.store.objects.size).toBe(0);
  });

  it('a cancel during retry backoff stops further attempts', async () => {
    const box = {} as { ctx: ReturnType<typeof setup> };
    const provider = new ScriptedProvider(['fail', 'ok']);
    box.ctx = setup({
      provider,
      sleep: async () => box.ctx.queue.cancel('job-1'),
    });
    const job = await runOne(box.ctx);
    expect(job.status).toBe('cancelled');
    expect(provider.calls).toBe(1);
    expect(box.ctx.queue.attachedAudio(NARRATION_ID)).toBeNull();
  });

  it('a claim superseded by cancel → re-queue → re-claim never writes (lease fencing)', async () => {
    const box = {} as {
      ctx: ReturnType<typeof setup>;
      fresh?: Awaited<ReturnType<InMemoryTtsJobQueue['claimNext']>>;
    };
    const provider = new ScriptedProvider(['ok'], async (call) => {
      if (call !== 1) return;
      // While the first claim synthesizes: API cancel, API re-queue of the
      // same id, and another worker claims it.
      box.ctx.queue.cancel('job-1');
      box.ctx.queue.enqueue(queuedJob());
      box.fresh = await box.ctx.queue.claimNext();
    });
    box.ctx = setup({ provider });
    const stale = await runOne(box.ctx);
    expect(stale.status).toBe('running'); // owned by the fresh claim now
    expect(box.ctx.queue.attachedAudio(NARRATION_ID)).toBeNull();
    expect(box.ctx.store.objects.size).toBe(0);

    const job = await box.ctx.runner.process(box.fresh!);
    expect(job.status).toBe('succeeded');
    expect(box.ctx.queue.attachedAudio(NARRATION_ID)?.generatedBy.jobId).toBe(
      'job-1',
    );
  });

  it('a stale re-claim continues after the spent attempts and dead-letters an exhausted job', async () => {
    const provider = new ScriptedProvider(['ok']);
    const ctx = setup({ provider });
    const first = await ctx.queue.claimNext();
    await ctx.queue.updateRunning(
      { ...first!.job, attempts: 2 },
      first!.leaseToken,
    );
    const resumed = await ctx.runner.process(ctx.queue.reclaimStale('job-1')!);
    expect(resumed).toMatchObject({ status: 'succeeded', attempts: 3 });
    expect(provider.calls).toBe(1);

    const lost = setup({ provider: new ScriptedProvider(['ok']) });
    const claim = await lost.queue.claimNext();
    await lost.queue.updateRunning(
      { ...claim!.job, attempts: 3 },
      claim!.leaseToken,
    );
    const job = await lost.runner.process(lost.queue.reclaimStale('job-1')!);
    expect(job).toMatchObject({
      status: 'failed',
      deadLettered: true,
      attempts: 3,
      errorCode: 'TTS_WORKER_LOST',
    });
    expect(lost.provider.calls).toBe(0);
  });

  it('a running job never exposes the previous attempt errorCode (I02-10)', async () => {
    const seen: Array<string | null> = [];
    const box = {} as { ctx: ReturnType<typeof setup> };
    const provider = new ScriptedProvider(['fail', 'ok'], async () => {
      seen.push((await box.ctx.queue.findById('job-1'))!.errorCode);
    });
    box.ctx = setup({ provider, job: { errorCode: 'TTS_TIMEOUT' } });
    const job = await runOne(box.ctx);
    expect(job.status).toBe('succeeded');
    expect(job.attempts).toBe(2);
    expect(seen).toEqual([null, null]);
  });

  it('retries, then dead-letters with a stable code and no transcript leak', async () => {
    const ctx = setup({ provider: new ScriptedProvider(['fail']) });
    const job = await runOne(ctx);
    expect(job).toMatchObject({
      status: 'failed',
      deadLettered: true,
      attempts: 3,
      errorCode: 'TTS_PROVIDER_ERROR',
    });
    expect(JSON.stringify(job)).not.toContain('secret');
    expect(ctx.queue.attachedAudio(NARRATION_ID)).toBeNull();
  });

  it('rejects invalid audio with TTS_AUDIO_INVALID', async () => {
    const ctx = setup({ provider: new ScriptedProvider(['bad']) });
    expect((await runOne(ctx)).errorCode).toBe('TTS_AUDIO_INVALID');
  });

  it('retries a storage failure and surfaces TTS_STORAGE_ERROR when it persists', async () => {
    const ok = setup();
    ok.store.failNext = 1;
    expect((await runOne(ok)).status).toBe('succeeded');

    const bad = setup();
    bad.store.failNext = 3;
    expect(await runOne(bad)).toMatchObject({
      status: 'failed',
      errorCode: 'TTS_STORAGE_ERROR',
    });
  });

  it('fails fast with TTS_MODEL_UNAVAILABLE when the job model does not match the worker voice (I02-8)', async () => {
    const ctx = setup({ job: { modelVersion: '0' } });
    const job = await runOne(ctx);
    expect(job).toMatchObject({
      status: 'failed',
      errorCode: 'TTS_MODEL_UNAVAILABLE',
      deadLettered: false,
    });
    expect(ctx.provider.calls).toBe(0);

    const none = setup({ binding: null });
    expect((await runOne(none)).errorCode).toBe('TTS_MODEL_UNAVAILABLE');
  });

  it('refuses a narration that is no longer a draft', async () => {
    const ctx = setup({ narration: { status: 'pending_review' } });
    const job = await runOne(ctx);
    expect(job.errorCode).toBe('TTS_NARRATION_NOT_DRAFT');
    expect(ctx.provider.calls).toBe(0);
  });

  it('refuses a transcript edited after enqueue (stale hash)', async () => {
    const ctx = setup({
      narration: { transcript: `${TRANSCRIPT} (đã sửa)` },
    });
    expect((await runOne(ctx)).errorCode).toBe('TTS_TRANSCRIPT_STALE');
  });

  it('does not attach when the narration was submitted during synthesis', async () => {
    const box = {} as { ctx: ReturnType<typeof setup> };
    const provider = new ScriptedProvider(['ok'], async () => {
      box.ctx.queue.setNarration(narration({ status: 'pending_review' }));
    });
    box.ctx = setup({ provider });
    const job = await runOne(box.ctx);
    expect(job.errorCode).toBe('TTS_NARRATION_NOT_DRAFT');
    expect(box.ctx.queue.attachedAudio(NARRATION_ID)).toBeNull();
  });
});

describe('TtsJobConsumer', () => {
  function consumer(
    ctx: ReturnType<typeof setup>,
    options: { enabled?: boolean; quota?: QuotaGuard } = {},
  ) {
    return new TtsJobConsumer(ctx.queue, ctx.runner, {
      flags: () => ({ ttsGenerationEnabled: options.enabled ?? true }),
      quota:
        options.quota ??
        new QuotaGuard({
          windowMs: 60_000,
          maxPerWindow: 10,
          maxConcurrent: 2,
        }),
      now: () => AT.getTime(),
    });
  }

  it('claims a queued job exactly once', async () => {
    const ctx = setup();
    const c = consumer(ctx);
    const first = await c.tick();
    expect(first.state).toBe('started');
    expect(await c.tick()).toEqual({ state: 'idle' });
    if (first.state === 'started')
      expect((await first.done).status).toBe('succeeded');
  });

  it('kill switch off: does not claim; the job stays queued (AI08)', async () => {
    const ctx = setup();
    expect(await consumer(ctx, { enabled: false }).tick()).toEqual({
      state: 'disabled',
    });
    expect((await ctx.queue.findById('job-1'))?.status).toBe('queued');
  });

  it('quota: concurrency cap and rate window throttle claiming (AI08)', async () => {
    const ctx = setup();
    const busy = new QuotaGuard({
      windowMs: 60_000,
      maxPerWindow: 10,
      maxConcurrent: 1,
    });
    busy.tryAcquire('tts-worker', AT.getTime());
    expect(await consumer(ctx, { quota: busy }).tick()).toEqual({
      state: 'throttled',
      reason: 'concurrency_limited',
    });

    const spent = new QuotaGuard({
      windowMs: 60_000,
      maxPerWindow: 1,
      maxConcurrent: 4,
    });
    spent.tryAcquire('tts-worker', AT.getTime());
    spent.release('tts-worker');
    expect(await consumer(ctx, { quota: spent }).tick()).toEqual({
      state: 'throttled',
      reason: 'rate_limited',
    });
    expect((await ctx.queue.findById('job-1'))?.status).toBe('queued');
  });

  it('releases the concurrency slot after the job finishes', async () => {
    const ctx = setup();
    const quota = new QuotaGuard({
      windowMs: 60_000,
      maxPerWindow: 10,
      maxConcurrent: 1,
    });
    const tick = await consumer(ctx, { quota }).tick();
    expect(quota.inFlight('tts-worker')).toBe(1);
    if (tick.state === 'started') await tick.done;
    expect(quota.inFlight('tts-worker')).toBe(0);
  });
});
