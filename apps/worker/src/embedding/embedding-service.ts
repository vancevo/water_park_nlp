import { buildPoiEmbeddingDocument } from './poi-document.js';
import type {
  EmbeddingDocument,
  EmbeddingProvider,
  EmbeddingRepository,
  EmbeddingWrite,
  StoredEmbeddingMetadata,
} from './types.js';

export interface EmbeddingRunOptions {
  batchSize?: number;
  force?: boolean;
  maxAttempts?: number;
}

export interface EmbeddingRunResult {
  scanned: number;
  skipped: number;
  embedded: number;
  batches: number;
}

const keyOf = (
  value: Pick<StoredEmbeddingMetadata, 'entityType' | 'entityId' | 'locale'>,
) => `${value.entityType}\u0000${value.entityId}\u0000${value.locale}`;

export class EmbeddingService {
  constructor(
    private readonly repository: EmbeddingRepository,
    private readonly provider: EmbeddingProvider,
  ) {}

  async run(options: EmbeddingRunOptions = {}): Promise<EmbeddingRunResult> {
    const batchSize = positiveInteger(options.batchSize ?? 32, 'batchSize');
    const maxAttempts = positiveInteger(
      options.maxAttempts ?? 3,
      'maxAttempts',
    );
    const sources = await this.repository.listPublishedPoiSources();
    const documents = sources.map(buildPoiEmbeddingDocument);
    const current = options.force
      ? new Map<string, string>()
      : new Map(
          (
            await this.repository.listMetadata(
              this.provider.model,
              this.provider.modelVersion,
            )
          ).map((item) => [keyOf(item), item.contentHash]),
        );
    const pending = documents.filter(
      (document) => current.get(keyOf(document)) !== document.contentHash,
    );

    let batches = 0;
    for (let offset = 0; offset < pending.length; offset += batchSize) {
      const batch = pending.slice(offset, offset + batchSize);
      const vectors = await this.embedWithRetry(batch, maxAttempts);
      const writes: EmbeddingWrite[] = batch.map((document, index) => ({
        document,
        model: this.provider.model,
        modelVersion: this.provider.modelVersion,
        vector: vectors[index]!,
      }));
      await this.repository.upsertMany(writes);
      batches += 1;
    }

    return {
      scanned: documents.length,
      skipped: documents.length - pending.length,
      embedded: pending.length,
      batches,
    };
  }

  private async embedWithRetry(
    documents: readonly EmbeddingDocument[],
    maxAttempts: number,
  ): Promise<readonly (readonly number[])[]> {
    let lastError: unknown;
    for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
      try {
        const vectors = await this.provider.embed(
          documents.map((item) => item.content),
        );
        validateVectors(vectors, documents.length, this.provider.dimensions);
        return vectors;
      } catch (error) {
        lastError = error;
      }
    }
    throw lastError;
  }
}

function positiveInteger(value: number, name: string): number {
  if (!Number.isInteger(value) || value <= 0) {
    throw new Error(`${name} must be a positive integer`);
  }
  return value;
}

function validateVectors(
  vectors: readonly (readonly number[])[],
  expectedCount: number,
  expectedDimensions: number,
): void {
  if (vectors.length !== expectedCount) {
    throw new Error(
      `Embedding provider returned ${vectors.length} vectors for ${expectedCount} documents`,
    );
  }
  vectors.forEach((vector, index) => {
    if (
      vector.length !== expectedDimensions ||
      vector.some((value) => !Number.isFinite(value))
    ) {
      throw new Error(
        `Embedding vector ${index} must contain ${expectedDimensions} finite numbers`,
      );
    }
  });
}
