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

function build(
  options: {
    narrations?: readonly NarrationRecord[];
    jobs?: readonly TtsJobRecord[];
  } = {},
): { service: AdminTtsJobService; repo: InMemoryTtsJobRepository } {
  const repo = new InMemoryTtsJobRepository(options.jobs ?? []);
  const service = new AdminTtsJobService(
    repo,
    new FakeNarrationRepository(options.narrations ?? [narration()]),
    locales(),
    () => new Date('2026-02-02T02:02:02.000Z'),
    DEFAULTS,
  );
  return { service, repo };
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
});
