export { EmbeddingService } from './embedding/embedding-service.js';
export type {
  EmbeddingRunOptions,
  EmbeddingRunResult,
} from './embedding/embedding-service.js';
export {
  buildPoiDocumentContent,
  buildPoiEmbeddingDocument,
  hashEmbeddingContent,
} from './embedding/poi-document.js';
export { PostgresEmbeddingRepository } from './embedding/postgres-embedding.repository.js';
export type {
  EmbeddingDocument,
  EmbeddingProvider,
  EmbeddingRepository,
  EmbeddingWrite,
  PoiEmbeddingSource,
} from './embedding/types.js';

export function startWorker(): void {
  // Queue/CLI composition belongs here once a production embedding provider and
  // database client are selected. The domain service itself remains injectable.
  console.log('Dam Sen worker ready');
}
