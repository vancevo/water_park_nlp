import { Buffer } from 'node:buffer';

import {
  CreateBucketCommand,
  HeadBucketCommand,
  PutObjectCommand,
  S3Client,
} from '@aws-sdk/client-s3';

/**
 * Where the worker puts synthesized audio (I02, ADR 0004/0014). Objects are
 * private, immutable and content-addressed (`poi/{poiId}/{locale}/{sha256}.wav`)
 * so the API's existing `verifyAudioObject` (size, MIME, sha256 metadata and
 * S3 checksum) accepts them at narration submit.
 */
export interface TtsAudioPut {
  objectKey: string;
  body: Uint8Array;
  mimeType: 'audio/wav';
  sha256: string;
}

export interface TtsAudioStore {
  put(input: TtsAudioPut): Promise<void>;
}

/** Stable, non-sensitive error for storage failures (retried like any attempt). */
export class TtsStorageError extends Error {
  readonly code = 'TTS_STORAGE_ERROR';
  constructor() {
    super('tts audio storage failed');
    this.name = 'TtsStorageError';
  }
}

export interface S3TtsAudioStoreConfig {
  endpoint: string;
  region: string;
  bucket: string;
  accessKey: string;
  secretKey: string;
}

export class S3TtsAudioStore implements TtsAudioStore {
  private readonly client: S3Client;
  private bucketReady?: Promise<void>;

  constructor(
    private readonly config: S3TtsAudioStoreConfig,
    client?: S3Client,
  ) {
    this.client =
      client ??
      new S3Client({
        endpoint: config.endpoint,
        region: config.region,
        forcePathStyle: true,
        credentials: {
          accessKeyId: config.accessKey,
          secretAccessKey: config.secretKey,
        },
      });
  }

  async put(input: TtsAudioPut): Promise<void> {
    try {
      await this.ensureBucket();
      await this.client.send(
        new PutObjectCommand({
          Bucket: this.config.bucket,
          Key: input.objectKey,
          Body: input.body,
          ContentType: input.mimeType,
          ContentLength: input.body.length,
          ChecksumSHA256: Buffer.from(input.sha256, 'hex').toString('base64'),
          Metadata: { sha256: input.sha256 },
        }),
      );
    } catch {
      // Never surface provider/storage messages (may contain endpoints/keys).
      throw new TtsStorageError();
    }
  }

  /** Same lazy check-or-create as the API's media storage (dev convenience). */
  private ensureBucket(): Promise<void> {
    this.bucketReady ??= (async () => {
      try {
        await this.client.send(
          new HeadBucketCommand({ Bucket: this.config.bucket }),
        );
      } catch (error) {
        const status = (error as { $metadata?: { httpStatusCode?: number } })
          .$metadata?.httpStatusCode;
        if (status !== 404) throw error;
        await this.client.send(
          new CreateBucketCommand({ Bucket: this.config.bucket }),
        );
      }
    })().catch((error: unknown) => {
      this.bucketReady = undefined;
      throw error;
    });
    return this.bucketReady;
  }

  destroy(): void {
    this.client.destroy();
  }
}

/** In-memory store for tests and local runs without object storage. */
export class InMemoryTtsAudioStore implements TtsAudioStore {
  readonly objects = new Map<string, TtsAudioPut>();
  failNext = 0;

  async put(input: TtsAudioPut): Promise<void> {
    if (this.failNext > 0) {
      this.failNext -= 1;
      throw new TtsStorageError();
    }
    this.objects.set(input.objectKey, { ...input, body: input.body.slice() });
  }
}
