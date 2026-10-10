/**
 * TTS worker foundation (C03 / AI02).
 *
 * Provider-neutral, idempotent, offline narration synthesis. The domain depends
 * only on the {@link TtsProvider} port — never on a concrete engine SDK. A real
 * adapter (Piper) arrives in AI03; the admin API endpoints in AI04.
 *
 * Privacy: transcripts, prompts, audio bytes and reference voices are never
 * logged. Reproducibility: every artifact records provider, model, immutable
 * version, config hash, transcript hash, seed and audio checksum.
 */

/** Job lifecycle status. Mirrors the locked public contract (do not extend). */
export type TtsJobStatus =
  | 'queued'
  | 'running'
  | 'succeeded'
  | 'failed'
  | 'cancelled';

/** What the domain asks a provider to synthesize. Never logged. */
export interface TtsSynthesisRequest {
  /** Reviewed transcript text. */
  transcript: string;
  /** BCP 47 narration locale, e.g. `vi`, `en`, `fr`. */
  locale: string;
  /** Voice id resolved from the model registry. */
  voiceId: string;
  /** Provider config; hashed into the artifact for reproducibility. */
  config: Record<string, string | number | boolean>;
  /** Deterministic seed when the provider supports it. */
  seed: number | null;
  /**
   * Aborted when the per-attempt timeout fires. A provider must stop its engine
   * process then, so a timed-out attempt cannot keep running beside the retry.
   */
  signal?: AbortSignal;
}

/** Lossless intermediate produced by a provider (WAV before release encoding). */
export interface TtsSynthesisResult {
  audio: Uint8Array;
  mimeType: 'audio/wav';
  durationSeconds: number;
  sampleRateHz: number;
}

/**
 * The only surface the domain knows about an engine. Implementations run in an
 * isolated process/container (AI03); the foundation only needs this contract.
 */
export interface TtsProvider {
  readonly provider: string;
  readonly model: string;
  /** Immutable, pinned model revision — never `main`/`latest`. */
  readonly modelVersion: string;
  supportsLocale(locale: string): boolean;
  synthesize(request: TtsSynthesisRequest): Promise<TtsSynthesisResult>;
}

/** One registered provider/model/voice with its license and integrity data. */
export interface TtsModelRegistryEntry {
  provider: string;
  model: string;
  modelVersion: string;
  voiceId: string;
  /** BCP 47 locale this voice serves. */
  locale: string;
  /** License of THIS artifact (engine/weights/voice); never inferred. */
  license: string;
  sourceUrl: string;
  /** sha256 of the pinned model artifact. */
  checksum: string;
  enabled: boolean;
}

/** Versioned, reproducible metadata persisted with a generated draft. */
export interface TtsArtifact {
  provider: string;
  model: string;
  modelVersion: string;
  voiceId: string;
  license: string;
  /** sha256 of the provider config used. */
  configHash: string;
  /** sha256 of the normalized transcript. */
  transcriptHash: string;
  seed: number | null;
  /** sha256 of the synthesized audio bytes. */
  audioSha256: string;
  sizeBytes: number;
  durationSeconds: number;
  sampleRateHz: number;
  /**
   * Format of the stored audio the hashes describe: the WAV intermediate, or
   * the release encoding when `TTS_AUDIO_RELEASE_FORMAT` is mp3/m4a (C04).
   */
  mimeType: 'audio/wav' | 'audio/mpeg' | 'audio/mp4';
  /**
   * Private object-storage key of the stored audio (I02). Set only by the queue
   * consumer, which uploads the bytes and attaches them to the draft narration.
   * Never returned by the public API.
   */
  objectKey?: string;
}

export interface TtsJobRecord {
  id: string;
  narrationId: string;
  status: TtsJobStatus;
  provider: string;
  model: string;
  modelVersion: string;
  transcriptHash: string;
  /** `${narrationId}:${transcriptHash}:${modelVersion}` — see idempotencyKey(). */
  idempotencyKey: string;
  attempts: number;
  maxAttempts: number;
  /** True when a failed job exhausted its retries and will not run again. */
  deadLettered: boolean;
  /** Stable error code only — never a stack, transcript or provider key. */
  errorCode: string | null;
  artifact: TtsArtifact | null;
  createdAt: Date;
  updatedAt: Date;
}

export interface TtsJobRepository {
  findByIdempotencyKey(key: string): Promise<TtsJobRecord | null>;
  findById(id: string): Promise<TtsJobRecord | null>;
  save(record: TtsJobRecord): Promise<void>;
}

/** Terminal states never re-run. */
export function isTerminalTtsStatus(status: TtsJobStatus): boolean {
  return (
    status === 'succeeded' || status === 'cancelled' || status === 'failed'
  );
}
