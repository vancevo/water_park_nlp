import { describe, expect, it } from 'vitest';
import {
  MAX_AUDIO_BYTES,
  audioMetadata,
  sha256Hex,
  validateAudioFile,
} from './narration-media';

describe('narration audio validation', () => {
  it('accepts supported audio and rejects unsafe type, empty, and oversized files', () => {
    expect(validateAudioFile({ type: 'audio/mpeg', size: 12 })).toBe('');
    expect(validateAudioFile({ type: 'text/plain', size: 12 })).toContain(
      'MP3',
    );
    expect(validateAudioFile({ type: 'audio/ogg', size: 0 })).toContain('rỗng');
    expect(
      validateAudioFile({ type: 'audio/wav', size: MAX_AUDIO_BYTES + 1 }),
    ).toContain('50 MiB');
  });

  it('computes the standard lowercase SHA-256 digest', async () => {
    await expect(sha256Hex(new Blob(['abc']))).resolves.toBe(
      'ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad',
    );
  });

  it('builds stored metadata without leaking whitespace into rights fields', () => {
    const metadata = audioMetadata(
      {
        objectKey: 'private-key',
        uploadUrl: 'https://upload.example',
        method: 'PUT',
        expiresAt: '2026-01-01T00:00:00.000Z',
        requiredHeaders: {
          'content-type': 'audio/mpeg',
          'content-length': '12',
          'x-amz-checksum-sha256': 'checksum',
          'x-amz-meta-sha256': 'hash',
        },
      },
      { type: 'audio/mpeg', size: 12 },
      'a'.repeat(64),
      5,
      {
        rightsOwner: ' Owner ',
        rightsSource: ' Source ',
        usageRights: ' Licensed ',
      },
    );
    expect(metadata).toMatchObject({
      objectKey: 'private-key',
      rightsOwner: 'Owner',
      rightsSource: 'Source',
      usageRights: 'Licensed',
      durationSeconds: 5,
    });
  });
});
