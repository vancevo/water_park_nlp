import type {
  MediaUploadIntent,
  NarrationAudioMetadataInput,
} from '@damsen/shared-types';

export const MAX_AUDIO_BYTES = 50 * 1024 * 1024;
export const ALLOWED_AUDIO_MIME_TYPES = [
  'audio/mpeg',
  'audio/mp4',
  'audio/ogg',
  'audio/wav',
] as const;

export type AllowedAudioMimeType = (typeof ALLOWED_AUDIO_MIME_TYPES)[number];

export function validateAudioFile(file: Pick<File, 'size' | 'type'>): string {
  if (!ALLOWED_AUDIO_MIME_TYPES.includes(file.type as AllowedAudioMimeType))
    return 'Chỉ chấp nhận MP3, M4A/MP4, OGG hoặc WAV.';
  if (file.size < 1) return 'Tệp audio đang rỗng.';
  if (file.size > MAX_AUDIO_BYTES) return 'Tệp audio phải không quá 50 MiB.';
  return '';
}

export async function sha256Hex(blob: Blob): Promise<string> {
  const digest = await globalThis.crypto.subtle.digest(
    'SHA-256',
    await blob.arrayBuffer(),
  );
  return [...new Uint8Array(digest)]
    .map((byte) => byte.toString(16).padStart(2, '0'))
    .join('');
}

export function audioMetadata(
  intent: MediaUploadIntent,
  file: Pick<File, 'size' | 'type'>,
  sha256: string,
  durationSeconds: number,
  rights: {
    rightsOwner: string;
    rightsSource: string;
    usageRights: string;
  },
): NarrationAudioMetadataInput {
  return {
    objectKey: intent.objectKey,
    mimeType: file.type as AllowedAudioMimeType,
    sizeBytes: file.size,
    sha256,
    durationSeconds,
    rightsOwner: rights.rightsOwner.trim(),
    rightsSource: rights.rightsSource.trim(),
    usageRights: rights.usageRights.trim(),
  };
}
