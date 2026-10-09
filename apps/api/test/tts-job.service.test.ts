import { BadRequestException, NotFoundException } from '@nestjs/common';
import { parseNarrationLocaleConfig } from '@damsen/config';
import { beforeEach, describe, expect, it } from 'vitest';

import { NarrationLocalesService } from '../src/narration/narration-locales.service.js';
import { InMemoryTtsJobRepository } from '../src/narration/in-memory-tts-job.repository.js';
import {
  type TtsJobDefaults,
  type TtsJobRecord,
} from '../src/narration/tts-job.models.js';
import { AdminTtsJobService } from '../src/narration/tts-job.service.js';
import {
  TtsJobControls,
  type TtsJobControlsConfig,
} from '../src/narration/tts-job-controls.js';
import type {
  NarrationRecord,
  NarrationRepository,
} from '../src/narration/narration.models.js';

const NARRATION_ID = '00000000-0000-4000-8000-000000000301';

const DEFAULTS: TtsJobDefaults = {
  provider: 'piper',
  model: 'piper',
  modelVersion: 'test-1',
  maxAttempts: 3,
};

/** Minimal narration repository that only needs to answer findById for TTS. */
class FakeNarrationRepository implements NarrationRepository {
  private readonly byId = new Map<string, NarrationRecord>();

  constructor(records: readonly NarrationRecord[]) {
    for (const record of records) this.byId.set(record.id, record);
  }

  async findById(id: string): Promise<NarrationRecord | null> {
    return this.byId.get(id) ?? null;
  }

  async findPublished(): Promise<NarrationRecord | null> {
    return null;
  }
  async findByPoi(): Promise<NarrationRecord[]> {
    return [];
  }
  async nextRevision(): Promise<number> {
    return 1;
  }
  async save(): Promise<void> {}
  async delete(): Promise<void> {}
  async publish(): Promise<void> {}
}

function narration(overrides: Partial<NarrationRecord> = {}): NarrationRecord {
  const at = new Date('2026-01-01T00:00:00.000Z');
  return {
    id: NARRATION_ID,
    poiId: '00000000-0000-4000-8000-000000000101',
    locale: 'vi',
    revision: 1,
    transcript: 'Bản thuyết minh tiếng Việt đã được duyệt cho khu vui chơi.',
    status: 'draft',
    audio: null,
    createdAt: at,
    updatedAt: at,
    ...overrides,
  };
}

function locales(): NarrationLocalesService {
  const config = parseNarrationLocaleConfig({
    defaultLocale: 'vi',
    locales: [
      { code: 'vi', nativeLabel: 'Tiếng Việt', speechTag: 'vi-VN' },
      {
        code: 'en',
        nativeLabel: 'English',
        speechTag: 'en-US',
        fallbackLocale: 'vi',
      },
      {
        code: 'de',
        nativeLabel: 'Deutsch',
        speechTag: 'de-DE',
        enabled: false,
      },
    ],
  });
  return new NarrationLocalesService(config);
}

const CONTROLS: TtsJobControlsConfig = {
  enabled: () => true,
  windowMs: 60_000,
  maxPerWindow: 100,
  maxActive: 100,
};

function build(
  options: {
    narrations?: readonly NarrationRecord[];
    jobs?: readonly TtsJobRecord[];
    defaults?: TtsJobDefaults;
    controls?: Partial<TtsJobControlsConfig>;
  } = {},
): { service: AdminTtsJobService; repo: InMemoryTtsJobRepository } {
  const repo = new InMemoryTtsJobRepository(options.jobs ?? []);
  const service = new AdminTtsJobService(
    repo,
    new FakeNarrationRepository(options.narrations ?? [narration()]),
    locales(),
    () => new Date('2026-02-02T02:02:02.000Z'),
    options.defaults ?? DEFAULTS,
    new TtsJobControls({ ...CONTROLS, ...options.controls }, () => 1_000_000),
  );
  return { service, repo };
}

function job(overrides: Partial<TtsJobRecord> = {}): TtsJobRecord {
  return {
    id: '00000000-0000-4000-8000-0000000003aa',
    narrationId: NARRATION_ID,
    status: 'succeeded',
    provider: 'piper',
    model: 'piper',
    modelVersion: 'test-1',
    transcriptHash: 'a'.repeat(64),
    idempotencyKey: `${NARRATION_ID}:${'a'.repeat(64)}:test-1`,
    attempts: 1,
    maxAttempts: 3,
    deadLettered: false,
    errorCode: null,
    createdAt: new Date('2026-01-01T00:00:00.000Z'),
    updatedAt: new Date('2026-01-01T00:00:00.000Z'),
    ...overrides,
  };
}

describe('AdminTtsJobService', () => {
  let service: AdminTtsJobService;
  let repo: InMemoryTtsJobRepository;

  beforeEach(() => {
    ({ service, repo } = build());
  });

  it('enqueues a queued job for a valid narration (draft only, no error)', async () => {
    const job = await service.create(NARRATION_ID, { locale: 'vi' });
    expect(job).toMatchObject({
      narrationId: NARRATION_ID,
      status: 'queued',
      provider: 'piper',
      model: 'piper',
      modelVersion: 'test-1',
    });
    expect(job.errorCode).toBeUndefined();
    expect(job.id).toMatch(/[0-9a-f-]{36}/);
  });

  it('is idempotent: a duplicate request returns the same job', async () => {
    const first = await service.create(NARRATION_ID, { locale: 'vi' });
    const second = await service.create(NARRATION_ID, { locale: 'vi' });
    expect(second.id).toBe(first.id);
    // Same idempotency key → a single stored row the second call reused.
    const stored = await repo.findById(first.id);
    expect(stored?.status).toBe('queued');
  });

  it('re-enqueues a cancelled job in place', async () => {
    const created = await service.create(NARRATION_ID, { locale: 'vi' });
    const cancelled = await service.cancel(created.id);
    expect(cancelled.status).toBe('cancelled');

    const reenqueued = await service.create(NARRATION_ID, { locale: 'vi' });
    expect(reenqueued.id).toBe(created.id);
    expect(reenqueued.status).toBe('queued');
  });

  it('honours provider/model overrides', async () => {
    const job = await service.create(NARRATION_ID, {
      locale: 'vi',
      provider: 'zerotts',
      model: 'zerotts-vi',
    });
    expect(job).toMatchObject({ provider: 'zerotts', model: 'zerotts-vi' });
  });

  it('rejects an unknown narration with 404', async () => {
    await expect(
      service.create('00000000-0000-4000-8000-0000000009ff', { locale: 'vi' }),
    ).rejects.toBeInstanceOf(NotFoundException);
  });

  it('rejects a disabled/unknown locale with 400', async () => {
    await expect(
      service.create(NARRATION_ID, { locale: 'de' }),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it('rejects a locale that does not match the narration locale', async () => {
    await expect(
      service.create(NARRATION_ID, { locale: 'en' }),
    ).rejects.toMatchObject({
      response: { code: 'TTS_JOB_LOCALE_MISMATCH' },
    });
  });

  it('rejects an empty transcript with 400', async () => {
    const empty = build({ narrations: [narration({ transcript: '   ' })] });
    await expect(
      empty.service.create(NARRATION_ID, { locale: 'vi' }),
    ).rejects.toMatchObject({ response: { code: 'TTS_JOB_TRANSCRIPT_EMPTY' } });
  });

  it('gets a job and 404s an unknown id', async () => {
    const created = await service.create(NARRATION_ID, { locale: 'vi' });
    expect((await service.get(created.id)).id).toBe(created.id);
    await expect(
      service.get('00000000-0000-4000-8000-0000000009ff'),
    ).rejects.toBeInstanceOf(NotFoundException);
  });

  it('cancels a queued job and leaves a terminal job unchanged', async () => {
    const created = await service.create(NARRATION_ID, { locale: 'vi' });
    const cancelled = await service.cancel(created.id);
    expect(cancelled.status).toBe('cancelled');

    const succeeded: TtsJobRecord = {
      id: '00000000-0000-4000-8000-0000000003aa',
      narrationId: NARRATION_ID,
      status: 'succeeded',
      provider: 'piper',
      model: 'piper',
      modelVersion: 'test-1',
      transcriptHash: 'a'.repeat(64),
      idempotencyKey: `${NARRATION_ID}:${'a'.repeat(64)}:test-1`,
      attempts: 1,
      maxAttempts: 3,
      deadLettered: false,
      errorCode: null,
      createdAt: new Date('2026-01-01T00:00:00.000Z'),
      updatedAt: new Date('2026-01-01T00:00:00.000Z'),
    };
    const withSucceeded = build({ jobs: [succeeded] });
    const unchanged = await withSucceeded.service.cancel(succeeded.id);
    expect(unchanged.status).toBe('succeeded');
  });

  it('404s when cancelling an unknown job', async () => {
    await expect(
      service.cancel('00000000-0000-4000-8000-0000000009ff'),
    ).rejects.toBeInstanceOf(NotFoundException);
  });

  // --- I02 ---

  it('rejects a non-draft narration with 409 NARRATION_NOT_DRAFT (I02-5)', async () => {
    for (const status of ['pending_review', 'published', 'rejected'] as const) {
      const built = build({ narrations: [narration({ status })] });
      await expect(
        built.service.create(NARRATION_ID, { locale: 'vi' }),
      ).rejects.toMatchObject({
        status: 409,
        response: { code: 'NARRATION_NOT_DRAFT' },
      });
    }
  });

  it('kill switch off → 503 AI_FEATURE_DISABLED; poll and cancel still work (I02-4)', async () => {
    let enabled = true;
    const built = build({ controls: { enabled: () => enabled } });
    const created = await built.service.create(NARRATION_ID, { locale: 'vi' });
    enabled = false;
    await expect(
      built.service.create(NARRATION_ID, { locale: 'vi' }),
    ).rejects.toMatchObject({
      status: 503,
      response: { code: 'AI_FEATURE_DISABLED' },
    });
    expect((await built.service.get(created.id)).status).toBe('queued');
    expect((await built.service.cancel(created.id)).status).toBe('cancelled');
  });

  it('per-actor rate window → 429 rate_limited (I02-4)', async () => {
    const built = build({ controls: { maxPerWindow: 1 } });
    const first = await built.service.create(
      NARRATION_ID,
      { locale: 'vi' },
      'u1',
    );
    // Idempotent replays do not consume quota.
    await built.service.create(NARRATION_ID, { locale: 'vi' }, 'u1');
    await built.service.cancel(first.id);
    await expect(
      built.service.create(NARRATION_ID, { locale: 'vi' }, 'u1'),
    ).rejects.toMatchObject({
      status: 429,
      response: { code: 'rate_limited', details: { retryAfterSeconds: 60 } },
    });
    // Another actor has its own window.
    expect(
      (await built.service.create(NARRATION_ID, { locale: 'vi' }, 'u2')).status,
    ).toBe('queued');
  });

  it('backlog cap → 429 concurrency_limited (I02-4)', async () => {
    const other = '00000000-0000-4000-8000-000000000999';
    const built = build({
      controls: { maxActive: 1 },
      jobs: [
        job({
          id: '00000000-0000-4000-8000-0000000003bb',
          narrationId: other,
          status: 'running',
          idempotencyKey: 'other',
        }),
      ],
    });
    await expect(
      built.service.create(NARRATION_ID, { locale: 'vi' }),
    ).rejects.toMatchObject({
      status: 429,
      response: { code: 'concurrency_limited' },
    });
  });

  it('one active job per narration: a different transcript waits (409 TTS_JOB_IN_PROGRESS)', async () => {
    const built = build({
      jobs: [job({ status: 'running', idempotencyKey: 'older-transcript' })],
    });
    await expect(
      built.service.create(NARRATION_ID, { locale: 'vi' }),
    ).rejects.toMatchObject({
      status: 409,
      response: { code: 'TTS_JOB_IN_PROGRESS' },
    });
  });

  it('cancel never overwrites a result the worker committed (I02-2)', async () => {
    const built = build();
    const created = await built.service.create(NARRATION_ID, { locale: 'vi' });
    const stored = (await built.repo.findById(created.id))!;
    // Worker finishes first.
    await built.repo.workerWrite({ ...stored, status: 'succeeded' });
    expect((await built.service.cancel(created.id)).status).toBe('succeeded');
  });

  it('a succeeded job is idempotent only while the draft still carries its audio', async () => {
    const draft = narration();
    const built = build({ narrations: [draft] });
    const created = await built.service.create(NARRATION_ID, { locale: 'vi' });
    const stored = (await built.repo.findById(created.id))!;
    const sha = 'c'.repeat(64);
    await built.repo.workerWrite({
      ...stored,
      status: 'succeeded',
      attempts: 1,
      artifact: {
        voiceId: 'vi-voice',
        license: 'MIT',
        audioSha256: sha,
        sizeBytes: 100,
        durationSeconds: 2,
        sampleRateHz: 22050,
        mimeType: 'audio/wav',
      },
    });
    // What the worker attached to the draft.
    draft.audio = {
      objectKey: `poi/${draft.poiId}/vi/${sha}.wav`,
      mimeType: 'audio/wav',
      sizeBytes: 100,
      sha256: sha,
      durationSeconds: 2,
      rightsOwner: 'Project',
      rightsSource: 'AI-generated draft',
      usageRights: 'Draft only',
    };
    draft.audioGeneratedBy = {
      provider: 'piper',
      model: 'piper',
      modelVersion: 'test-1',
      voiceId: 'vi-voice',
      license: 'MIT',
      jobId: created.id,
      generatedAt: '2026-02-02T02:02:02.000Z',
    };
    expect(
      await built.service.create(NARRATION_ID, { locale: 'vi' }),
    ).toMatchObject({ id: created.id, status: 'succeeded' });

    // The editor replaced the audio (or edited the transcript away and back):
    // "succeeded" would lie, so the same row is re-run.
    draft.audio = { ...draft.audio, sha256: 'd'.repeat(64) };
    draft.audioGeneratedBy = null;
    const rerun = await built.service.create(NARRATION_ID, { locale: 'vi' });
    expect(rerun).toMatchObject({ id: created.id, status: 'queued' });
    expect(rerun.artifact).toBeUndefined();
    expect((await built.repo.findById(created.id))?.artifact).toBeNull();
  });

  it('hides errorCode unless the job failed, and exposes the artifact summary on success (I02-10, I02-3)', async () => {
    const running = build({
      jobs: [job({ status: 'running', errorCode: 'TTS_TIMEOUT' })],
    });
    expect((await running.service.get(job().id)).errorCode).toBeUndefined();

    const done = build({
      jobs: [
        job({
          artifact: {
            voiceId: 'vi-voice',
            license: 'MIT',
            audioSha256: 'c'.repeat(64),
            sizeBytes: 100,
            durationSeconds: 2,
            sampleRateHz: 22050,
            mimeType: 'audio/wav',
          },
        }),
      ],
    });
    expect((await done.service.get(job().id)).artifact).toEqual({
      voiceId: 'vi-voice',
      license: 'MIT',
      audioSha256: 'c'.repeat(64),
      sizeBytes: 100,
      durationSeconds: 2,
      sampleRateHz: 22050,
      mimeType: 'audio/wav',
    });
  });

  it('latest job per narration: null, then the newest (I02-11)', async () => {
    const built = build();
    expect(await built.service.latest(NARRATION_ID)).toEqual({ job: null });
    const created = await built.service.create(NARRATION_ID, { locale: 'vi' });
    expect((await built.service.latest(NARRATION_ID)).job?.id).toBe(created.id);
    await expect(
      built.service.latest('00000000-0000-4000-8000-0000000009ff'),
    ).rejects.toBeInstanceOf(NotFoundException);
  });

  it('per-locale voices from the worker manifest stamp the matching model version (I02-8)', async () => {
    const built = build({
      defaults: {
        ...DEFAULTS,
        voices: {
          vi: { provider: 'piper', model: 'vi_VN-x', modelVersion: 'v-vi' },
        },
      },
    });
    expect(
      await built.service.create(NARRATION_ID, { locale: 'vi' }),
    ).toMatchObject({
      provider: 'piper',
      model: 'vi_VN-x',
      modelVersion: 'v-vi',
    });
    await expect(
      built.service.create(NARRATION_ID, { locale: 'vi', model: 'other' }),
    ).rejects.toMatchObject({ response: { code: 'TTS_VOICE_UNAVAILABLE' } });
  });
});
