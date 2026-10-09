import { S3Client } from '@aws-sdk/client-s3';
import { describe, expect, it } from 'vitest';

import {
  S3MediaStorage,
  SIGNED_UPLOAD_HEADERS,
} from '../src/narration/media-storage.js';

/**
 * B03 regression (I04): real S3/MinIO reject a presigned PUT that carries
 * `x-amz-*` headers which are not part of `X-Amz-SignedHeaders` ("There were
 * headers present in the request which were not signed"). The S3 emulator used
 * before I04 accepted it, so the upload headers must be asserted here.
 */
function storage(): S3MediaStorage {
  const client = new S3Client({
    endpoint: 'http://127.0.0.1:9',
    region: 'us-east-1',
    forcePathStyle: true,
    credentials: { accessKeyId: 'test', secretAccessKey: 'test-secret' },
  });
  // Bucket check only; signing itself is offline.
  client.send = (async () => ({})) as unknown as S3Client['send'];
  return new S3MediaStorage(client, 'media', () => new Date());
}

describe('S3MediaStorage.signUpload', () => {
  it('signs every header the client is told to send instead of hoisting it', async () => {
    const sha256 = 'a'.repeat(64);
    const signed = await storage().signUpload({
      objectKey: `poi/p/vi/${sha256}.wav`,
      mimeType: 'audio/wav',
      sizeBytes: 10,
      sha256,
    });
    const params = new URL(signed.url).searchParams;
    const signedHeaders = params.get('X-Amz-SignedHeaders')?.split(';') ?? [];
    for (const header of [...SIGNED_UPLOAD_HEADERS, 'content-length'])
      expect(signedHeaders).toContain(header);
    expect(params.has('x-amz-checksum-sha256')).toBe(false);
    expect(params.has('x-amz-meta-sha256')).toBe(false);
    expect(signed.checksumSha256Base64).toBe(
      Buffer.from(sha256, 'hex').toString('base64'),
    );
  });
});
