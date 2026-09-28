import { describe, expect, it, vi } from 'vitest';
import type { NarrationAudioMetadataInput } from '@damsen/shared-types';

import { InMemoryPoiRepository } from '../src/poi/in-memory-poi.repository.js';
import {
  MediaStorageUnavailableException,
  type MediaStorage,
  UnavailableMediaStorage,
} from '../src/narration/media-storage.js';
import { MediaService } from '../src/narration/media.service.js';

const POI_ID = '00000000-0000-4000-8000-000000000101';

function fakeStorage(): MediaStorage {
  return {
    signUpload: vi.fn().mockResolvedValue({
      url: 'http://storage.test/signed-put?signature=redacted',
      expiresAt: new Date('2026-01-01T00:05:00.000Z'),
      checksumSha256Base64: 'base64-checksum',
    }),
    signPlayback: vi.fn().mockResolvedValue({
      url: 'http://storage.test/signed-get?signature=redacted',
      expiresAt: new Date('2026-01-01T00:10:00.000Z'),
    }),
    verifyAudioObject: vi.fn().mockResolvedValue(undefined),
  };
}

describe('MediaService', () => {
  it('creates a deterministic, policy-bound upload intent', async () => {
    const storage = fakeStorage();
    const service = new MediaService(storage, new InMemoryPoiRepository());
    const sha256 = 'a'.repeat(64);

    const intent = await service.createUploadIntent({
      poiId: POI_ID,
      locale: 'vi',
      mimeType: 'audio/mpeg',
      sizeBytes: 1234,
      sha256,
    });

    expect(intent).toEqual({
      objectKey: `poi/${POI_ID}/vi/${sha256}.mp3`,
      uploadUrl: 'http://storage.test/signed-put?signature=redacted',
      method: 'PUT',
      expiresAt: '2026-01-01T00:05:00.000Z',
      requiredHeaders: {
        'content-type': 'audio/mpeg',
        'content-length': '1234',
        'x-amz-checksum-sha256': 'base64-checksum',
        'x-amz-meta-sha256': sha256,
      },
    });
    expect(storage.signUpload).toHaveBeenCalledWith({
      objectKey: intent.objectKey,
      mimeType: 'audio/mpeg',
      sizeBytes: 1234,
      sha256,
    });
    expect(JSON.stringify(intent)).not.toContain('secret');
  });

  it('returns the stable unavailable error when storage is disabled', async () => {
    const storage: MediaStorage = new UnavailableMediaStorage();
    await expect(
      storage.signUpload({
        objectKey: 'unused',
        mimeType: 'audio/mpeg',
        sizeBytes: 1,
        sha256: 'a'.repeat(64),
      }),
    ).rejects.toBeInstanceOf(MediaStorageUnavailableException);
    await expect(
      storage.verifyAudioObject({} as NarrationAudioMetadataInput),
    ).rejects.toMatchObject({ status: 503 });
  });
});
