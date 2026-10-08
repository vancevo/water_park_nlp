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

export {
  PiperTtsProvider,
  PiperSynthesisError,
  PiperTimeoutError,
  spawnPiperRunner,
} from './tts/piper/piper-tts-provider.js';
export type {
  PiperProviderConfig,
  PiperRunner,
  PiperRunInput,
} from './tts/piper/piper-tts-provider.js';
export {
  parsePiperVoiceManifest,
  loadPiperVoiceManifest,
  toTtsModelRegistry,
  buildPiperProvider,
  PiperVoiceManifestError,
} from './tts/piper/piper-voices.js';
export type {
  PiperVoiceManifest,
  PiperVoiceManifestEntry,
} from './tts/piper/piper-voices.js';
export { runTtsBenchmark } from './tts/piper/tts-benchmark.js';
export type {
  BenchmarkReport,
  BenchmarkSentence,
  BenchmarkSampleResult,
  BenchmarkOptions,
} from './tts/piper/tts-benchmark.js';
export { parseWav, WavParseError } from './tts/piper/wav.js';
export type { WavInfo } from './tts/piper/wav.js';

// AI05 — provider benchmark and selection.
export {
  CliTtsProvider,
  CliTtsSynthesisError,
  CliTtsTimeoutError,
  spawnCliRunner,
} from './tts/providers/cli-tts-provider.js';
export type {
  CliProviderSpec,
  CliRunner,
  CliRunInput,
  HardwareClass,
} from './tts/providers/cli-tts-provider.js';
export {
  parseBenchmarkProvidersManifest,
  loadBenchmarkProvidersManifest,
  buildBenchmarkProviders,
  toCliProviderSpec,
  BenchmarkProvidersManifestError,
} from './tts/providers/benchmark-providers-manifest.js';
export type {
  BenchmarkProviderEntry,
  BenchmarkProvidersManifest,
} from './tts/providers/benchmark-providers-manifest.js';
export { runProviderComparison } from './tts/providers/provider-benchmark.js';
export type {
  BenchmarkThresholds,
  ProviderCandidate,
  ProviderBenchmarkEntry,
  ProviderComparisonReport,
  ProviderComparisonOptions,
  BlindLabel,
  LocaleRecommendation,
} from './tts/providers/provider-benchmark.js';
export {
  validateProviderComparisonReport,
  assertValidProviderComparisonReport,
  ProviderBenchmarkReportError,
} from './tts/providers/provider-benchmark-report.js';

// AI08 — operational hardening (metrics, quota, retention, kill-switches).
export { MetricsRegistry, DEFAULT_LATENCY_BUCKETS_MS } from './ops/metrics.js';
export type { Labels, MetricsSnapshot } from './ops/metrics.js';
export { TtsMetrics } from './ops/tts-metrics.js';
export type { TtsJobLabels } from './ops/tts-metrics.js';
export {
  QuotaGuard,
  DEFAULT_QUOTA_CONFIG,
  loadQuotaConfig,
} from './ops/quota.js';
export type { QuotaConfig, QuotaDecision } from './ops/quota.js';
export {
  isExpired,
  selectExpiredJobs,
  loadRetentionPolicy,
  DEFAULT_RETENTION_POLICY,
} from './ops/retention.js';
export type { RetentionPolicy, RetainableJob } from './ops/retention.js';
export {
  loadAiFeatureFlags,
  assertTtsGenerationEnabled,
  AiFeatureDisabledError,
} from './ops/ai-feature-flags.js';
export type { AiFeatureFlags } from './ops/ai-feature-flags.js';

export function startWorker(): void {
  // Queue/CLI composition belongs here once a production embedding provider and
  // database client are selected. The domain service itself remains injectable.
  console.log('Dam Sen worker ready');
}
