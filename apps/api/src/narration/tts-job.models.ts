import type { TtsJobStatus } from '@damsen/shared-types';

/**
 * API-side view of a row in `tts_generation_jobs` (migration 010, owned by the
 * TTS worker foundation — C03/AI02). The admin API only ever *enqueues* a
 * `queued` job and transitions it to `cancelled`; actual synthesis, retries,
 * dead-lettering and the artifact manifest are the worker's job. The record
 * shape stays compatible with the shared table so a queued row the API writes
 * is the same row the worker later runs.
 *
 * Privacy: the record never carries transcript text or audio bytes — only the
 * normalized transcript hash and a stable error code.
 */
export interface TtsJobRecord {
  id: string;
  narrationId: string;
  status: TtsJobStatus;
  provider: string;
  model: string;
  modelVersion: string;
  /** sha256 of the NFC-normalized transcript (never the transcript itself). */
  transcriptHash: string;
  /** `${narrationId}:${transcriptHash}:${modelVersion}` — unique per artifact. */
  idempotencyKey: string;
  attempts: number;
  maxAttempts: number;
  deadLettered: boolean;
  /** Stable error code only — never a stack, transcript or provider key. */
  errorCode: string | null;
  createdAt: Date;
  updatedAt: Date;
}

/**
 * Persistence port for admin TTS jobs. `insert` creates a brand-new queued row
 * (and fails on a duplicate idempotency key); `save` upserts by id and is used
 * to re-enqueue a previously failed/cancelled job or to mark one cancelled.
 */
export interface TtsJobRepository {
  findById(id: string): Promise<TtsJobRecord | null>;
  findByIdempotencyKey(key: string): Promise<TtsJobRecord | null>;
  insert(record: TtsJobRecord): Promise<void>;
  save(record: TtsJobRecord): Promise<void>;
}

/**
 * Enqueue metadata the admin API stamps on a queued job when the request does
 * not override it. These defaults must match the worker's configured provider
 * in a given deployment; the worker reconciles the pinned model version when it
 * actually runs the job (finalized in integration/AI05).
 */
export interface TtsJobDefaults {
  provider: string;
  model: string;
  modelVersion: string;
  maxAttempts: number;
}

export const TTS_JOB_REPOSITORY = Symbol('TTS_JOB_REPOSITORY');
export const TTS_JOB_CLOCK = Symbol('TTS_JOB_CLOCK');
export const TTS_JOB_DEFAULTS = Symbol('TTS_JOB_DEFAULTS');

/** Reasonable fallback defaults, overridable via env at module wiring. */
export const FALLBACK_TTS_JOB_DEFAULTS: TtsJobDefaults = {
  provider: 'piper',
  model: 'piper',
  modelVersion: '0',
  maxAttempts: 3,
};

export function loadTtsJobDefaults(
  env: NodeJS.ProcessEnv = process.env,
): TtsJobDefaults {
  const maxAttempts = Number(env.TTS_JOB_MAX_ATTEMPTS ?? '3');
  return {
    provider: env.TTS_DEFAULT_PROVIDER ?? FALLBACK_TTS_JOB_DEFAULTS.provider,
    model: env.TTS_DEFAULT_MODEL ?? FALLBACK_TTS_JOB_DEFAULTS.model,
    modelVersion:
      env.TTS_DEFAULT_MODEL_VERSION ?? FALLBACK_TTS_JOB_DEFAULTS.modelVersion,
    maxAttempts:
      Number.isInteger(maxAttempts) && maxAttempts > 0
        ? maxAttempts
        : FALLBACK_TTS_JOB_DEFAULTS.maxAttempts,
  };
}

/** Terminal states never re-run; a new enqueue resets a terminal job. */
export function isTerminalTtsStatus(status: TtsJobStatus): boolean {
  return (
    status === 'succeeded' || status === 'failed' || status === 'cancelled'
  );
}
