export type SupportedLocale = 'vi' | 'en';

export interface PoiEmbeddingSource {
  id: string;
  locale: SupportedLocale;
  name: string;
  category: string;
  shortDescription: string;
  longDescription: string;
}

export interface EmbeddingDocument {
  entityType: 'poi';
  entityId: string;
  locale: SupportedLocale;
  content: string;
  contentHash: string;
}

export interface EmbeddingProvider {
  readonly model: string;
  readonly modelVersion: string;
  readonly dimensions: 1024;
  embed(documents: readonly string[]): Promise<readonly (readonly number[])[]>;
}

export interface StoredEmbeddingMetadata {
  entityType: string;
  entityId: string;
  locale: SupportedLocale;
  contentHash: string;
}

export interface EmbeddingWrite {
  document: EmbeddingDocument;
  model: string;
  modelVersion: string;
  vector: readonly number[];
}

export interface EmbeddingRepository {
  listPublishedPoiSources(): Promise<readonly PoiEmbeddingSource[]>;
  listMetadata(
    model: string,
    modelVersion: string,
  ): Promise<readonly StoredEmbeddingMetadata[]>;
  upsertMany(records: readonly EmbeddingWrite[]): Promise<void>;
}
