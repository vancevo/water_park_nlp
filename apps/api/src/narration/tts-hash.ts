import { createHash } from 'node:crypto';

/**
 * Deterministic transcript hashing and idempotency key for TTS enqueue.
 *
 * Intentionally mirrors `apps/worker/src/tts/tts-hash.ts`: the worker is a
 * self-contained workspace (it does not depend on `@damsen/*`) and the API may
 * not import from it, so the few lines that must agree across the boundary are
 * duplicated rather than shared. Keep the two in sync — the idempotency key is
 * what lets a queued row the API writes match the row the worker later runs.
 *
 * Only the hash ever leaves the request boundary; the raw transcript is never
 * logged or persisted in a job record.
 */

/** Normalize (NFC + collapse whitespace) then sha256 the transcript. */
export function transcriptHash(transcript: string): string {
  const normalized = transcript.normalize('NFC').replace(/\s+/gu, ' ').trim();
  return createHash('sha256').update(normalized, 'utf8').digest('hex');
}

/**
 * The same narration + transcript + model version maps to a single artifact, so
 * a duplicate request never re-synthesizes.
 */
export function idempotencyKey(
  narrationId: string,
  transcriptHashValue: string,
  modelVersion: string,
): string {
  return `${narrationId}:${transcriptHashValue}:${modelVersion}`;
}
