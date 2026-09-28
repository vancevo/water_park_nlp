import { describe, expect, it } from 'vitest';

import { EmbeddingService } from '../src/embedding/embedding-service.js';
import {
  buildPoiDocumentContent,
  buildPoiEmbeddingDocument,
  hashEmbeddingContent,
} from '../src/embedding/poi-document.js';
import type {
  EmbeddingProvider,
  EmbeddingRepository,
  EmbeddingWrite,
  PoiEmbeddingSource,
  StoredEmbeddingMetadata,
} from '../src/embedding/types.js';

const source: PoiEmbeddingSource = {
  id: '00000000-0000-4000-8000-000000000101',
  locale: 'vi',
  name: '  Vườn   hoa  ',
  category: 'garden',
  shortDescription: 'Không gian\n xanh',
  longDescription: 'Khám phá\r\n các loài hoa.',
};

class FakeProvider implements EmbeddingProvider {
  readonly model = 'deterministic-test-only';
  readonly dimensions = 1024 as const;
  calls: string[][] = [];

  constructor(readonly modelVersion: string) {}

  async embed(
    documents: readonly string[],
  ): Promise<readonly (readonly number[])[]> {
    this.calls.push([...documents]);
    return documents.map((document) =>
      Array.from({ length: this.dimensions }, (_, index) =>
        index === 0 ? document.length : 0,
      ),
    );
  }
}

class FakeRepository implements EmbeddingRepository {
  metadata: Array<
    StoredEmbeddingMetadata & { model: string; modelVersion: string }
  > = [];
  writes: EmbeddingWrite[] = [];

  constructor(readonly sources: readonly PoiEmbeddingSource[]) {}

  async listPublishedPoiSources() {
    return this.sources;
  }

  async listMetadata(model: string, modelVersion: string) {
    return this.metadata.filter(
      (item) => item.model === model && item.modelVersion === modelVersion,
    );
  }

  async upsertMany(records: readonly EmbeddingWrite[]) {
    this.writes.push(...records);
  }
}

describe('POI embedding document', () => {
  it('uses a stable language-specific template and canonical whitespace', () => {
    expect(buildPoiDocumentContent(source)).toBe(
      [
        'schema: poi-search-document/v1',
        'locale: vi',
        'name: Vườn hoa',
        'category: garden',
        'summary: Không gian xanh',
        'description: Khám phá các loài hoa.',
      ].join('\n'),
    );
  });

  it('generates a stable SHA-256 hash from canonical content', () => {
    const first = buildPoiEmbeddingDocument(source);
    const equivalent = buildPoiEmbeddingDocument({
      ...source,
      name: 'Vườn hoa',
      shortDescription: 'Không gian xanh',
      longDescription: 'Khám phá các loài hoa.',
    });

    expect(first.contentHash).toMatch(/^[0-9a-f]{64}$/);
    expect(first.contentHash).toBe(hashEmbeddingContent(first.content));
    expect(first.contentHash).toBe(equivalent.contentHash);
  });
});

describe('EmbeddingService', () => {
  it('skips an unchanged document for the same model version', async () => {
    const repository = new FakeRepository([source]);
    const provider = new FakeProvider('v1');
    const document = buildPoiEmbeddingDocument(source);
    repository.metadata.push({
      entityType: 'poi',
      entityId: source.id,
      locale: source.locale,
      contentHash: document.contentHash,
      model: provider.model,
      modelVersion: provider.modelVersion,
    });

    const result = await new EmbeddingService(repository, provider).run();

    expect(result).toEqual({ scanned: 1, skipped: 1, embedded: 0, batches: 0 });
    expect(provider.calls).toHaveLength(0);
    expect(repository.writes).toHaveLength(0);
  });

  it('embeds again when the model version changes', async () => {
    const repository = new FakeRepository([source]);
    const document = buildPoiEmbeddingDocument(source);
    repository.metadata.push({
      entityType: 'poi',
      entityId: source.id,
      locale: source.locale,
      contentHash: document.contentHash,
      model: 'deterministic-test-only',
      modelVersion: 'v1',
    });

    const provider = new FakeProvider('v2');
    const result = await new EmbeddingService(repository, provider).run();

    expect(result.embedded).toBe(1);
    expect(repository.writes[0]?.modelVersion).toBe('v2');
  });

  it('supports an explicit full re-index even when content is unchanged', async () => {
    const repository = new FakeRepository([source]);
    const provider = new FakeProvider('v1');
    const document = buildPoiEmbeddingDocument(source);
    repository.metadata.push({
      entityType: 'poi',
      entityId: source.id,
      locale: source.locale,
      contentHash: document.contentHash,
      model: provider.model,
      modelVersion: provider.modelVersion,
    });

    const result = await new EmbeddingService(repository, provider).run({
      force: true,
    });

    expect(result).toEqual({ scanned: 1, skipped: 0, embedded: 1, batches: 1 });
    expect(provider.calls).toHaveLength(1);
    expect(repository.writes).toHaveLength(1);
  });
});
