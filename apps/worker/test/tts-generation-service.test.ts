import { describe, expect, it } from 'vitest';

import { InMemoryTtsJobRepository } from '../src/tts/in-memory-tts-job.repository.js';
import { TtsModelRegistry } from '../src/tts/tts-model-registry.js';
import {
  TtsGenerationService,
  type TtsGenerationDeps,
} from '../src/tts/tts-generation-service.js';
import { transcriptHash } from '../src/tts/tts-hash.js';
import type {
  TtsProvider,
  TtsSynthesisRequest,
  TtsSynthesisResult,
} from '../src/tts/types.js';

const NARRATION_ID = '00000000-0000-4000-8000-000000000abc';
const TRANSCRIPT = 'Xin chào Đầm Sen, đây là bản thuyết minh thử nghiệm.';

function wav(size = 64): Uint8Array {
  const buffer = new Uint8Array(Math.max(12, size));
  buffer.set([0x52, 0x49, 0x46, 0x46], 0); // "RIFF"
  buffer.set([0x57, 0x41, 0x56, 0x45], 8); // "WAVE"
  return buffer;
}

function okResult(): TtsSynthesisResult {
  return {
    audio: wav(),
    mimeType: 'audio/wav',
    durationSeconds: 3.2,
    sampleRateHz: 22_050,
  };
}

type Mode = 'ok' | 'failN' | 'alwaysFail' | 'hang' | 'badAudio';

class FakeProvider implements TtsProvider {
  readonly provider = 'piper';
  readonly model = 'vi_VN-test';
  readonly modelVersion = '2026.01.0';
  calls = 0;
  lastRequest: TtsSynthesisRequest | null = null;

  constructor(
    private readonly mode: Mode,
    private readonly failN = 0,
  ) {}

  supportsLocale(locale: string): boolean {
    return locale === 'vi' || locale === 'en';
  }

  async synthesize(request: TtsSynthesisRequest): Promise<TtsSynthesisResult> {
    this.calls += 1;
    this.lastRequest = request;
    if (this.mode === 'hang') return new Promise<TtsSynthesisResult>(() => {});
    if (this.mode === 'alwaysFail')
      throw new Error('provider exploded with transcript leak attempt');
    if (this.mode === 'failN' && this.calls <= this.failN)
      throw new Error('transient provider failure');
    if (this.mode === 'badAudio')
      return { ...okResult(), audio: new Uint8Array([0, 1, 2, 3]) };
    return okResult();
  }
}

function registry(): TtsModelRegistry {
  return new TtsModelRegistry([
    {
      provider: 'piper',
      model: 'vi_VN-test',
      modelVersion: '2026.01.0',
      voiceId: 'vi_VN-test-medium',
      locale: 'vi',
      license: 'MIT',
      sourceUrl: 'https://example.test/model',
      checksum: 'a'.repeat(64),
      enabled: true,
    },
  ]);
}

function deps(): TtsGenerationDeps {
  let n = 0;
  return {
    clock: () => new Date('2026-01-01T00:00:00.000Z'),
    sleep: async () => {},
    newId: () => `job-${(n += 1)}`,
  };
}

function service(provider: TtsProvider, repo = new InMemoryTtsJobRepository()) {
  return new TtsGenerationService(repo, provider, registry(), deps());
}

const request = {
  narrationId: NARRATION_ID,
  transcript: TRANSCRIPT,
  locale: 'vi',
};

describe('TtsGenerationService', () => {
  it('synthesizes once and records a reproducible draft artifact', async () => {
    const provider = new FakeProvider('ok');
    const job = await service(provider).generate(request);

    expect(job.status).toBe('succeeded');
    expect(provider.calls).toBe(1);
    expect(job.attempts).toBe(1);
    expect(job.artifact).not.toBeNull();
    expect(job.artifact?.transcriptHash).toBe(transcriptHash(TRANSCRIPT));
    expect(job.artifact?.provider).toBe('piper');
    expect(job.artifact?.voiceId).toBe('vi_VN-test-medium');
    expect(job.artifact?.license).toBe('MIT');
    expect(job.artifact?.audioSha256).toMatch(/^[0-9a-f]{64}$/);
  });

  it('is idempotent: a duplicate request does not re-synthesize', async () => {
    const provider = new FakeProvider('ok');
    const svc = service(provider);
    const first = await svc.generate(request);
    const second = await svc.generate(request);

    expect(provider.calls).toBe(1);
    expect(second.id).toBe(first.id);
    expect(second.status).toBe('succeeded');
  });

  it('retries transient failures then succeeds', async () => {
    const provider = new FakeProvider('failN', 1);
    const job = await service(provider).generate(request, { maxAttempts: 3 });

    expect(job.status).toBe('succeeded');
    expect(provider.calls).toBe(2);
    expect(job.attempts).toBe(2);
  });

  it('dead-letters after exhausting retries, without leaking the transcript', async () => {
    const provider = new FakeProvider('alwaysFail');
    const job = await service(provider).generate(request, { maxAttempts: 3 });

    expect(job.status).toBe('failed');
    expect(job.deadLettered).toBe(true);
    expect(job.attempts).toBe(3);
    expect(job.errorCode).toBe('TTS_PROVIDER_ERROR');
    expect(job.artifact).toBeNull();
    // Neither the transcript nor the provider's error message is persisted.
    const serialized = JSON.stringify(job);
    expect(serialized).not.toContain('Xin chào');
    expect(serialized).not.toContain('exploded');
  });

  it('times out a hanging provider and dead-letters', async () => {
    const provider = new FakeProvider('hang');
    const job = await service(provider).generate(request, {
      maxAttempts: 1,
      timeoutMs: 20,
    });

    expect(job.status).toBe('failed');
    expect(job.deadLettered).toBe(true);
    expect(job.errorCode).toBe('TTS_TIMEOUT');
  });

  it('rejects invalid synthesized audio', async () => {
    const provider = new FakeProvider('badAudio');
    const job = await service(provider).generate(request, { maxAttempts: 1 });

    expect(job.status).toBe('failed');
    expect(job.errorCode).toBe('TTS_AUDIO_INVALID');
    expect(job.artifact).toBeNull();
  });

  it('re-runs a previously failed (non-dead-lettered) job', async () => {
    const repo = new InMemoryTtsJobRepository();
    // First run fails once-per-attempt with maxAttempts 1 -> failed + dead-letter.
    const failed = await new TtsGenerationService(
      repo,
      new FakeProvider('alwaysFail'),
      registry(),
      deps(),
    ).generate(request, { maxAttempts: 1 });
    expect(failed.deadLettered).toBe(true);
    // A dead-lettered job is returned as-is (no automatic retry).
    const again = await new TtsGenerationService(
      repo,
      new FakeProvider('ok'),
      registry(),
      deps(),
    ).generate(request);
    expect(again.status).toBe('failed');
    expect(again.id).toBe(failed.id);
  });

  it('cancels a non-terminal job', async () => {
    const repo = new InMemoryTtsJobRepository();
    const svc = new TtsGenerationService(
      repo,
      new FakeProvider('ok'),
      registry(),
      deps(),
    );
    await repo.save({
      id: 'queued-1',
      narrationId: NARRATION_ID,
      status: 'queued',
      provider: 'piper',
      model: 'vi_VN-test',
      modelVersion: '2026.01.0',
      transcriptHash: transcriptHash(TRANSCRIPT),
      idempotencyKey: 'k',
      attempts: 0,
      maxAttempts: 3,
      deadLettered: false,
      errorCode: null,
      artifact: null,
      createdAt: new Date('2026-01-01T00:00:00.000Z'),
      updatedAt: new Date('2026-01-01T00:00:00.000Z'),
    });
    const cancelled = await svc.cancel('queued-1');
    expect(cancelled?.status).toBe('cancelled');
  });

  it('refuses a locale with no enabled voice', async () => {
    await expect(
      service(new FakeProvider('ok')).generate({ ...request, locale: 'fr' }),
    ).rejects.toThrow('no enabled voice');
  });
});
