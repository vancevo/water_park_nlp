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

export {
  TtsGenerationService,
  TtsTimeoutError,
} from './tts/tts-generation-service.js';
export type {
  TtsGenerationRequest,
  TtsGenerateOptions,
  TtsGenerationDeps,
} from './tts/tts-generation-service.js';
export {
  TtsModelRegistry,
  TtsModelRegistryError,
} from './tts/tts-model-registry.js';
export {
  DEFAULT_TTS_AUDIO_LIMITS,
  TtsAudioInvalidError,
  isWavContainer,
  validateSynthesizedAudio,
} from './tts/tts-audio-validation.js';
export {
  configHash,
  idempotencyKey,
  sha256Hex,
  transcriptHash,
} from './tts/tts-hash.js';
export { InMemoryTtsJobRepository } from './tts/in-memory-tts-job.repository.js';
export { PostgresTtsJobRepository } from './tts/postgres-tts-job.repository.js';
export { isTerminalTtsStatus } from './tts/types.js';
export type {
  TtsArtifact,
  TtsJobRecord,
  TtsJobRepository,
  TtsJobStatus,
  TtsModelRegistryEntry,
  TtsProvider,
  TtsSynthesisRequest,
  TtsSynthesisResult,
} from './tts/types.js';

export function startWorker(): void {
  // Queue/CLI composition belongs here once a production embedding provider and
  // database client are selected. The domain service itself remains injectable.
  console.log('Dam Sen worker ready');
}
