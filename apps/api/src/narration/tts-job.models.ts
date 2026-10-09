import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

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
  /**
   * Artifact manifest written by the worker on success (read-only for the API;
   * the API never writes it). Contains no transcript and no audio bytes.
   */
  artifact?: TtsJobArtifactRecord | null;
  createdAt: Date;
  updatedAt: Date;
}

/** Subset of the worker's artifact manifest the API reads (migration 010 jsonb). */
export interface TtsJobArtifactRecord {
  voiceId: string;
  license: string;
  audioSha256: string;
  sizeBytes: number;
  durationSeconds: number;
  sampleRateHz: number;
  mimeType: 'audio/wav';
}

/**
 * Persistence port for admin TTS jobs. `insert` creates a brand-new queued row
 * (and fails on a duplicate idempotency key). Every state change after that is
 * a CONDITIONAL write (I02-2): the API only re-enqueues a row that is still
 * terminal (failed/cancelled) and only cancels a row that is still
 * queued/running, so it can never overwrite the worker's result and the worker
 * can never overwrite a cancel.
 */
export interface TtsJobRepository {
  findById(id: string): Promise<TtsJobRecord | null>;
  findByIdempotencyKey(key: string): Promise<TtsJobRecord | null>;
  /** Most recently created job of a narration, or null. */
  findLatestByNarration(narrationId: string): Promise<TtsJobRecord | null>;
  /** True when the narration has a `queued` or `running` job. */
  hasActiveForNarration(narrationId: string): Promise<boolean>;
  /** Number of `queued` + `running` jobs (backlog cap, AI08). */
  countActive(): Promise<number>;
  insert(record: TtsJobRecord): Promise<void>;
  /**
   * Reset a `failed`/`cancelled` row to `queued` with `record`'s fields.
   * Returns false when the row is no longer failed/cancelled.
   */
  requeue(record: TtsJobRecord): Promise<boolean>;
  /**
   * Mark a `queued`/`running` job `cancelled`. Returns the updated record, or
   * null when the job was already terminal (or does not exist).
   */
  cancelIfActive(id: string, at: Date): Promise<TtsJobRecord | null>;
}

/** Provider/model/version the worker serves for one locale. */
export interface TtsVoiceDefaults {
  provider: string;
  model: string;
  modelVersion: string;
}

/**
 * Enqueue metadata the admin API stamps on a queued job. It MUST match what the
 * worker serves, because both sides derive the idempotency key from
 * `modelVersion` and the worker fails a mismatched job with
 * `TTS_MODEL_UNAVAILABLE` (I02-8).
 *
 * - `voices` (preferred): per-locale voices read from the SAME manifest the
 *   worker loads (`TTS_VOICES_MANIFEST_PATH`). When present it is authoritative:
 *   a locale without an enabled voice is rejected at create.
 * - otherwise the single `provider`/`model`/`modelVersion` from
 *   `TTS_DEFAULT_*` applies to every locale.
 */
export interface TtsJobDefaults extends TtsVoiceDefaults {
  maxAttempts: number;
  voices?: Readonly<Record<string, TtsVoiceDefaults>>;
}

export const TTS_JOB_REPOSITORY = Symbol('TTS_JOB_REPOSITORY');
export const TTS_JOB_CLOCK = Symbol('TTS_JOB_CLOCK');
export const TTS_JOB_DEFAULTS = Symbol('TTS_JOB_DEFAULTS');

/**
 * Dev/test fallback only. `modelVersion: '0'` matches no real worker voice: the
 * worker fails such jobs with `TTS_MODEL_UNAVAILABLE` instead of leaving them
 * queued, and the API logs a warning at boot. Deployments set
 * `TTS_VOICES_MANIFEST_PATH` (preferred) or `TTS_DEFAULT_*` (`.env.example`).
 */
export const FALLBACK_TTS_JOB_DEFAULTS: TtsJobDefaults = {
  provider: 'piper',
  model: 'piper',
  modelVersion: '0',
  maxAttempts: 3,
};

export class TtsVoicesManifestError extends Error {
  constructor(message: string) {
    super(`tts voices manifest: ${message}`);
    this.name = 'TtsVoicesManifestError';
  }
}

/**
 * Read per-locale voices from the worker's voice manifest: the Piper format
 * (`{ voices: [...] }`) or the CLI provider format (`{ entries: [...] }`). Only
 * enabled entries count; the first enabled entry per locale wins (same rule as
 * the worker registry).
 */
export function parseTtsVoicesManifest(
  raw: unknown,
): Record<string, TtsVoiceDefaults> {
  if (typeof raw !== 'object' || raw === null)
    throw new TtsVoicesManifestError('manifest must be an object');
  const root = raw as { voices?: unknown; entries?: unknown };
  const list = root.voices ?? root.entries;
  if (!Array.isArray(list) || list.length === 0)
    throw new TtsVoicesManifestError(
      'voices/entries must be a non-empty array',
    );
  const voices: Record<string, TtsVoiceDefaults> = {};
  for (const [index, item] of list.entries()) {
    const entry = item as Record<string, unknown>;
    const fields = ['provider', 'model', 'modelVersion', 'locale'] as const;
    for (const field of fields) {
      if (typeof entry?.[field] !== 'string' || entry[field] === '')
        throw new TtsVoicesManifestError(`entry ${index} has no ${field}`);
    }
    if (entry.enabled === false) continue;
    const locale = entry.locale as string;
    voices[locale] ??= {
      provider: entry.provider as string,
      model: entry.model as string,
      modelVersion: entry.modelVersion as string,
    };
  }
  return voices;
}

export function loadTtsJobDefaults(
  env: NodeJS.ProcessEnv = process.env,
  readFile: (path: string) => string = (path) => readFileSync(path, 'utf8'),
): TtsJobDefaults {
  const maxAttempts = Number(env.TTS_JOB_MAX_ATTEMPTS ?? '3');
  const manifestPath = env.TTS_VOICES_MANIFEST_PATH?.trim();
  let voices: Record<string, TtsVoiceDefaults> | undefined;
  if (manifestPath) {
    let contents: string;
    try {
      contents = readFile(resolve(process.cwd(), manifestPath));
    } catch {
      throw new TtsVoicesManifestError(`cannot read "${manifestPath}"`);
    }
    try {
      voices = parseTtsVoicesManifest(JSON.parse(contents));
    } catch (error) {
      if (error instanceof TtsVoicesManifestError) throw error;
      throw new TtsVoicesManifestError(`"${manifestPath}" is not valid JSON`);
    }
  }
  return {
    provider: env.TTS_DEFAULT_PROVIDER || FALLBACK_TTS_JOB_DEFAULTS.provider,
    model: env.TTS_DEFAULT_MODEL || FALLBACK_TTS_JOB_DEFAULTS.model,
    modelVersion:
      env.TTS_DEFAULT_MODEL_VERSION || FALLBACK_TTS_JOB_DEFAULTS.modelVersion,
    maxAttempts:
      Number.isInteger(maxAttempts) && maxAttempts > 0
        ? maxAttempts
        : FALLBACK_TTS_JOB_DEFAULTS.maxAttempts,
    ...(voices ? { voices } : {}),
  };
}

/** True when neither a manifest nor TTS_DEFAULT_MODEL_VERSION is configured. */
export function usesFallbackTtsDefaults(
  env: NodeJS.ProcessEnv = process.env,
): boolean {
  return (
    !env.TTS_VOICES_MANIFEST_PATH?.trim() && !env.TTS_DEFAULT_MODEL_VERSION
  );
}

/** Terminal states never re-run; a new enqueue resets a terminal job. */
export function isTerminalTtsStatus(status: TtsJobStatus): boolean {
  return (
    status === 'succeeded' || status === 'failed' || status === 'cancelled'
  );
}
