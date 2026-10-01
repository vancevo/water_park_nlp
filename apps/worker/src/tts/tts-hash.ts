import { createHash } from 'node:crypto';

/**
 * Deterministic hashing for TTS reproducibility and idempotency. Hashes are the
 * only representation of transcript/config that ever leaves the domain — the raw
 * transcript is never logged or stored in the job record.
 */

export function sha256Hex(data: string | Uint8Array): string {
  const hash = createHash('sha256');
  hash.update(typeof data === 'string' ? Buffer.from(data, 'utf8') : data);
  return hash.digest('hex');
}

/** Normalize (NFC + collapse whitespace) then hash the transcript. */
export function transcriptHash(transcript: string): string {
  const normalized = transcript.normalize('NFC').replace(/\s+/gu, ' ').trim();
  return sha256Hex(normalized);
}

/** Stable, key-sorted hash of the provider config. */
export function configHash(
  config: Record<string, string | number | boolean>,
): string {
  const canonical = JSON.stringify(
    Object.fromEntries(
      Object.entries(config).sort(([a], [b]) => a.localeCompare(b)),
    ),
  );
  return sha256Hex(canonical);
}

/**
 * Idempotency key: the same narration + transcript + model version must map to a
 * single artifact, so a duplicate request never re-synthesizes.
 */
export function idempotencyKey(
  narrationId: string,
  transcriptHashValue: string,
  modelVersion: string,
): string {
  return `${narrationId}:${transcriptHashValue}:${modelVersion}`;
}
