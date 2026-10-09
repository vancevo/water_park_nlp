import { describe, expect, it } from 'vitest';
import { parseNarrationLocaleConfig } from '@damsen/config';

import { InMemoryPoiRepository } from '../src/poi/in-memory-poi.repository.js';
import { InMemoryNarrationRepository } from '../src/narration/in-memory-narration.repository.js';
import { InMemoryTtsJobRepository } from '../src/narration/in-memory-tts-job.repository.js';
import type { MediaStorage } from '../src/narration/media-storage.js';
import type { NarrationRecord } from '../src/narration/narration.models.js';
import { NarrationLocalesService } from '../src/narration/narration-locales.service.js';
import { NarrationService } from '../src/narration/narration.service.js';

const POI_ID = '00000000-0000-4000-8000-000000000101';
const ID = '00000000-0000-4000-8000-0000000007a1';
const SHA = 'd'.repeat(64);
const NOW = new Date('2026-10-09T00:00:00.000Z');

const storage: MediaStorage = {
  async signUpload() {
    throw new Error('unused');
  },
  async signPlayback(objectKey) {
    return {
      url: `https://storage.test/${objectKey}?sig=1`,
      expiresAt: new Date(NOW.getTime() + 600_000),
    };
  },
  async verifyAudioObject() {},
};

function aiDraft(): NarrationRecord {
  return {
    id: ID,
    poiId: POI_ID,
    locale: 'vi',
    revision: 2,
    transcript: 'Bản nháp có audio do AI tạo, chờ biên tập viên nghe lại.',
    status: 'draft',
    audio: {
      objectKey: `poi/${POI_ID}/vi/${SHA}.wav`,
      mimeType: 'audio/wav',
      sizeBytes: 1000,
      sha256: SHA,
      durationSeconds: 2,
      rightsOwner: 'Project (AI draft)',
      rightsSource: 'AI-generated draft',
      usageRights: 'Draft only',
    },
    audioGeneratedBy: {
      provider: 'piper',
      model: 'vi-voice',
      modelVersion: 'v1',
      voiceId: 'vi-voice',
      license: 'MIT',
      jobId: '00000000-0000-4000-8000-0000000007b1',
      generatedAt: NOW.toISOString(),
    },
    createdAt: NOW,
    updatedAt: NOW,
  };
}

function service(): NarrationService {
  return new NarrationService(
    new InMemoryNarrationRepository([aiDraft()]),
    new InMemoryPoiRepository(),
    () => NOW,
    storage,
    new NarrationLocalesService(
      parseNarrationLocaleConfig({
        defaultLocale: 'vi',
        locales: [
          { code: 'vi', nativeLabel: 'Tiếng Việt', speechTag: 'vi-VN' },
          { code: 'en', nativeLabel: 'English', speechTag: 'en-US' },
        ],
      }),
    ),
    new InMemoryTtsJobRepository(),
  );
}

describe('NarrationService AI audio (I02-3, I02-11)', () => {
  it('exposes AI provenance and a signed admin preview URL for the draft audio', async () => {
    const svc = service();
    const [listed] = await svc.list(POI_ID);
    expect(listed?.audioGeneratedBy).toMatchObject({
      provider: 'piper',
      modelVersion: 'v1',
      jobId: '00000000-0000-4000-8000-0000000007b1',
    });
    expect(listed?.status).toBe('draft');
    expect(await svc.audioPlayback(ID)).toEqual({
      playbackUrl: `https://storage.test/poi/${POI_ID}/vi/${SHA}.wav?sig=1`,
      playbackExpiresAt: new Date(NOW.getTime() + 600_000).toISOString(),
    });
  });

  it('keeps provenance on a transcript-only edit and drops it when the audio is replaced', async () => {
    const svc = service();
    const edited = await svc.update(ID, {
      transcript: 'Bản nháp đã sửa câu chữ, audio AI vẫn giữ nguyên như cũ.',
    });
    expect(edited.audioGeneratedBy?.jobId).toBe(
      '00000000-0000-4000-8000-0000000007b1',
    );

    const otherSha = 'e'.repeat(64);
    const replaced = await svc.update(ID, {
      audio: {
        ...aiDraft().audio!,
        objectKey: `poi/${POI_ID}/vi/${otherSha}.mp3`,
        mimeType: 'audio/mpeg',
        sha256: otherSha,
        rightsOwner: 'Editor upload',
      },
    });
    expect(replaced.audioGeneratedBy).toBeUndefined();

    const removed = await service().update(ID, { audio: null });
    expect(removed.audio).toBeNull();
    expect(removed.audioGeneratedBy).toBeUndefined();
  });

  it('labels published AI audio for visitors without the internal job id (v1.2)', async () => {
    const svc = service();
    await svc.submit(ID);
    await svc.approve(ID, 'reviewer-1');
    const published = await svc.published(POI_ID, 'vi');
    expect(published.audio?.generatedBy).toEqual({
      provider: 'piper',
      model: 'vi-voice',
      modelVersion: 'v1',
      voiceId: 'vi-voice',
      license: 'MIT',
      generatedAt: NOW.toISOString(),
    });
    expect(JSON.stringify(published)).not.toContain(
      '00000000-0000-4000-8000-0000000007b1',
    );
  });

  it('omits generatedBy for editor-uploaded published audio', async () => {
    const svc = service();
    await svc.update(ID, {
      audio: {
        ...aiDraft().audio!,
        objectKey: `poi/${POI_ID}/vi/${'f'.repeat(64)}.wav`,
        sha256: 'f'.repeat(64),
        rightsOwner: 'Editor upload',
      },
    });
    await svc.submit(ID);
    await svc.approve(ID, 'reviewer-1');
    const published = await svc.published(POI_ID, 'vi');
    expect(published.audio).not.toBeNull();
    expect(published.audio).not.toHaveProperty('generatedBy');
  });
});
