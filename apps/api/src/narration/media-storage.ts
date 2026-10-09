import {
  CreateBucketCommand,
  GetObjectCommand,
  HeadBucketCommand,
  HeadObjectCommand,
  PutObjectCommand,
  S3Client,
} from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import {
  BadRequestException,
  ServiceUnavailableException,
} from '@nestjs/common';
import type { NarrationAudioMetadataInput } from '@damsen/shared-types';
import { loadRuntimeConfig } from '@damsen/config';

export interface UploadSigningInput {
  objectKey: string;
  mimeType: string;
  sizeBytes: number;
  sha256: string;
}

export interface SignedUpload {
  url: string;
  expiresAt: Date;
  checksumSha256Base64: string;
}

export interface SignedPlayback {
  url: string;
  expiresAt: Date;
}

export interface MediaStorage {
  signUpload(input: UploadSigningInput): Promise<SignedUpload>;
  signPlayback(objectKey: string): Promise<SignedPlayback>;
  verifyAudioObject(input: NarrationAudioMetadataInput): Promise<void>;
}

export const MEDIA_STORAGE = Symbol('MEDIA_STORAGE');

/** Headers the presigned upload URL signs; the client must send exactly these. */
export const SIGNED_UPLOAD_HEADERS = [
  'content-type',
  'x-amz-checksum-sha256',
  'x-amz-meta-sha256',
] as const;

export class MediaStorageUnavailableException extends ServiceUnavailableException {
  constructor() {
    super({
      code: 'MEDIA_STORAGE_UNAVAILABLE',
      message: 'Media storage is unavailable',
      details: null,
    });
  }
}

export class MediaObjectInvalidException extends BadRequestException {
  constructor() {
    super({
      code: 'MEDIA_OBJECT_INVALID',
      message: 'Uploaded audio is missing or does not match its metadata',
      details: null,
    });
  }
}

export class UnavailableMediaStorage implements MediaStorage {
  async signUpload(): Promise<SignedUpload> {
    throw new MediaStorageUnavailableException();
  }

  async signPlayback(): Promise<SignedPlayback> {
    throw new MediaStorageUnavailableException();
  }

  async verifyAudioObject(): Promise<void> {
    throw new MediaStorageUnavailableException();
  }
}

export class S3MediaStorage implements MediaStorage {
  private bucketReady?: Promise<void>;

  constructor(
    private readonly client: S3Client,
    private readonly bucket: string,
    private readonly now: () => Date = () => new Date(),
  ) {}

  async signUpload(input: UploadSigningInput): Promise<SignedUpload> {
    await this.ensureBucket();
    const checksumSha256Base64 = Buffer.from(input.sha256, 'hex').toString(
      'base64',
    );
    const expiresIn = 5 * 60;
    try {
      const url = await getSignedUrl(
        this.client,
        new PutObjectCommand({
          Bucket: this.bucket,
          Key: input.objectKey,
          ContentType: input.mimeType,
          ContentLength: input.sizeBytes,
          ChecksumSHA256: checksumSha256Base64,
          Metadata: { sha256: input.sha256 },
        }),
        {
          expiresIn,
          // The client sends these as headers (`requiredHeaders`), so they
          // must be signed headers, not hoisted into the query string: real
          // S3/MinIO reject unsigned `x-amz-*` headers (B03, I04). Signing
          // them also binds the MIME type and checksum to the URL.
          signableHeaders: new Set(SIGNED_UPLOAD_HEADERS),
          unhoistableHeaders: new Set(SIGNED_UPLOAD_HEADERS),
        },
      );
      return {
        url,
        expiresAt: new Date(this.now().getTime() + expiresIn * 1000),
        checksumSha256Base64,
      };
    } catch {
      throw new MediaStorageUnavailableException();
    }
  }

  async signPlayback(objectKey: string): Promise<SignedPlayback> {
    const expiresIn = 10 * 60;
    try {
      const url = await getSignedUrl(
        this.client,
        new GetObjectCommand({ Bucket: this.bucket, Key: objectKey }),
        { expiresIn },
      );
      return {
        url,
        expiresAt: new Date(this.now().getTime() + expiresIn * 1000),
      };
    } catch {
      throw new MediaStorageUnavailableException();
    }
  }

  async verifyAudioObject(input: NarrationAudioMetadataInput): Promise<void> {
    const expectedChecksum = Buffer.from(input.sha256, 'hex').toString(
      'base64',
    );
    try {
      const object = await this.client.send(
        new HeadObjectCommand({
          Bucket: this.bucket,
          Key: input.objectKey,
          ChecksumMode: 'ENABLED',
        }),
      );
      if (
        object.ContentLength !== input.sizeBytes ||
        object.ContentType !== input.mimeType ||
        object.Metadata?.sha256 !== input.sha256 ||
        (object.ChecksumSHA256 !== undefined &&
          object.ChecksumSHA256 !== expectedChecksum)
      ) {
        throw new MediaObjectInvalidException();
      }
    } catch (error) {
      if (error instanceof MediaObjectInvalidException) throw error;
      const status = (error as { $metadata?: { httpStatusCode?: number } })
        .$metadata?.httpStatusCode;
      if (status === 404) throw new MediaObjectInvalidException();
      throw new MediaStorageUnavailableException();
    }
  }

  private async ensureBucket(): Promise<void> {
    this.bucketReady ??= this.checkOrCreateBucket();
    try {
      await this.bucketReady;
    } catch {
      this.bucketReady = undefined;
      throw new MediaStorageUnavailableException();
    }
  }

  private async checkOrCreateBucket(): Promise<void> {
    try {
      await this.client.send(new HeadBucketCommand({ Bucket: this.bucket }));
    } catch (error) {
      const status = (error as { $metadata?: { httpStatusCode?: number } })
        .$metadata?.httpStatusCode;
      if (status !== 404) throw error;
      await this.client.send(new CreateBucketCommand({ Bucket: this.bucket }));
    }
  }
}

export function createMediaStorage(): MediaStorage {
  const config = loadRuntimeConfig().objectStorage;
  if (!config.enabled) return new UnavailableMediaStorage();
  return new S3MediaStorage(
    new S3Client({
      endpoint: config.endpoint,
      region: config.region,
      forcePathStyle: true,
      credentials: {
        accessKeyId: config.accessKey,
        secretAccessKey: config.secretKey,
      },
    }),
    config.bucket,
  );
}
