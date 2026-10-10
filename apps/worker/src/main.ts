import {
  startTtsWorker,
  type RunningTtsWorker,
} from './tts/tts-worker-runtime.js';

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
  buildTtsArtifact,
  errorCodeOf,
  withTimeout,
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

// I02 — queue consumer: claim → synthesize → store audio → attach to draft.
export type {
  ClaimedTtsJob,
  DraftAudioAttachment,
  TtsAudioProvenance,
  TtsCompletionOutcome,
  TtsJobQueue,
  TtsNarrationSnapshot,
} from './tts/tts-job-queue.js';
export { InMemoryTtsJobQueue } from './tts/in-memory-tts-job-queue.js';
export { PostgresTtsJobQueue } from './tts/postgres-tts-job-queue.js';
export type {
  PostgresTtsJobQueueOptions,
  SqlTransactionalPool,
} from './tts/postgres-tts-job-queue.js';
export {
  InMemoryTtsAudioStore,
  S3TtsAudioStore,
  TtsStorageError,
} from './tts/tts-audio-store.js';
export type {
  S3TtsAudioStoreConfig,
  TtsAudioPut,
  TtsAudioStore,
} from './tts/tts-audio-store.js';
export {
  TTS_JOB_PRECONDITION_CODES,
  TtsJobConsumer,
  TtsJobRunner,
} from './tts/tts-job-runner.js';
export type {
  TtsConsumerTick,
  TtsJobConsumerOptions,
  TtsJobRunnerConfig,
  TtsJobRunnerDeps,
  TtsVoiceBinding,
} from './tts/tts-job-runner.js';
export {
  loadTtsWorkerConfig,
  loadVoiceBindings,
  startTtsWorker,
  TtsWorkerConfigError,
} from './tts/tts-worker-runtime.js';
export type {
  RunningTtsWorker,
  TtsWorkerConfig,
  TtsWorkerEngine,
} from './tts/tts-worker-runtime.js';
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

// C04 — release encoding (mp3/m4a) of the validated WAV intermediate.
export {
  FfmpegAudioEncoder,
  createAudioEncoder,
  loadAudioEncoderConfig,
  verifyEncodedAudio,
  AudioEncoderConfigError,
  TtsEncodeError,
  RELEASE_MIME,
} from './tts/audio-encoder.js';
export type {
  AudioEncoder,
  AudioEncoderConfig,
  EncodedAudio,
  TtsReleaseFormat,
  TtsReleaseMimeType,
} from './tts/audio-encoder.js';

// AI08 — operational hardening (metrics, quota, retention, kill-switches).
export { MetricsRegistry, DEFAULT_LATENCY_BUCKETS_MS } from './ops/metrics.js';
export type { Labels, MetricsSnapshot } from './ops/metrics.js';
export {
  createMetricsServer,
  loadMetricsServerConfig,
  startMetricsServer,
  MetricsServerConfigError,
  PROMETHEUS_CONTENT_TYPE,
} from './ops/metrics-server.js';
export type {
  MetricsServerConfig,
  RunningMetricsServer,
} from './ops/metrics-server.js';
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

/**
 * Start the worker process: the TTS queue consumer (I02). The embedding
 * pipeline stays a library until a production embedding provider is selected.
 * The process entrypoint is `src/worker.ts`.
 */
export function startWorker(
  env: NodeJS.ProcessEnv = process.env,
): RunningTtsWorker {
  return startTtsWorker(env);
}
