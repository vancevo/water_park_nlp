import assert from 'node:assert/strict';
import { Buffer } from 'node:buffer';
import { createHash } from 'node:crypto';
import process from 'node:process';

import { DeleteObjectCommand, S3Client } from '@aws-sdk/client-s3';

import { S3MediaStorage } from '../apps/api/dist/narration/media-storage.js';

const endpoint = process.env.S3_ENDPOINT ?? 'http://127.0.0.1:9000';
const region = process.env.S3_REGION ?? 'us-east-1';
const bucket = process.env.S3_BUCKET ?? 'damsen-media';
const client = new S3Client({
  endpoint,
  region,
  forcePathStyle: true,
  credentials: {
    accessKeyId: process.env.S3_ACCESS_KEY ?? 'damsen_local',
    secretAccessKey: process.env.S3_SECRET_KEY ?? 'damsen_local_password',
  },
});
const storage = new S3MediaStorage(client, bucket);
const body = Buffer.from('synthetic audio bytes for storage smoke test\n');
const sha256 = createHash('sha256').update(body).digest('hex');
const objectKey = `smoke/${sha256}.wav`;

try {
  const upload = await storage.signUpload({
    objectKey,
    mimeType: 'audio/wav',
    sizeBytes: body.length,
    sha256,
  });
  const response = await globalThis.fetch(upload.url, {
    method: 'PUT',
    headers: {
      'content-type': 'audio/wav',
      'content-length': String(body.length),
      'x-amz-checksum-sha256': upload.checksumSha256Base64,
      'x-amz-meta-sha256': sha256,
    },
    body,
  });
  assert.equal(response.ok, true, `PUT failed with ${response.status}`);
  await storage.verifyAudioObject({
    objectKey,
    mimeType: 'audio/wav',
    sizeBytes: body.length,
    sha256,
    durationSeconds: 1,
    rightsOwner: 'Synthetic test fixture',
    rightsSource: 'Generated locally',
    usageRights: 'Testing only',
  });
  const playback = await storage.signPlayback(objectKey);
  const downloaded = Buffer.from(
    await (await globalThis.fetch(playback.url)).arrayBuffer(),
  );
  assert.deepEqual(downloaded, body);
  process.stdout.write(
    'MinIO signed PUT, HEAD verification and signed GET passed.\n',
  );
} finally {
  await client.send(
    new DeleteObjectCommand({ Bucket: bucket, Key: objectKey }),
  );
  client.destroy();
}
