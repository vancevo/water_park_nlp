import { describe, expect, it } from 'vitest';

import {
  TtsWorkerConfigError,
  loadTtsWorkerConfig,
  minimumStaleRunningMs,
} from '../src/tts/tts-worker-runtime.js';

const base = {
  DATABASE_URL: 'postgresql://x',
  S3_ENDPOINT: 'http://localhost:9000',
  S3_BUCKET: 'b',
  S3_ACCESS_KEY: 'a',
  S3_SECRET_KEY: 's',
};

describe('F7: stale-running window covers a live attempt', () => {
  it('adds synthesis timeout, three storage calls and the longest backoff', () => {
    expect(
      minimumStaleRunningMs({
        timeoutMs: 120_000,
        baseBackoffMs: 500,
        maxAttempts: 3,
      }),
    ).toBe(120_000 + 180_000 + 1_000);
  });

  it('accepts the default 30 minute window', () => {
    expect(loadTtsWorkerConfig(base).staleRunningMs).toBe(30 * 60_000);
  });

  it('rejects a window that only just exceeds the synthesis timeout', () => {
    expect(() =>
      loadTtsWorkerConfig({
        ...base,
        TTS_JOB_TIMEOUT_MS: '120000',
        TTS_JOB_STALE_RUNNING_MS: '130000',
      }),
    ).toThrow(TtsWorkerConfigError);
  });

  it('accounts for a larger attempt count and backoff', () => {
    expect(() =>
      loadTtsWorkerConfig({
        ...base,
        TTS_JOB_TIMEOUT_MS: '60000',
        TTS_JOB_BACKOFF_MS: '60000',
        TTS_JOB_MAX_ATTEMPTS: '5',
        TTS_JOB_STALE_RUNNING_MS: '400000',
      }),
    ).toThrow(/must exceed one attempt/);
  });
});
