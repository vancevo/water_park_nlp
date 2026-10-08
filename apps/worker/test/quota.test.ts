import { describe, expect, it } from 'vitest';

import { QuotaGuard, loadQuotaConfig } from '../src/ops/quota.js';

describe('QuotaGuard', () => {
  it('rate-limits after maxPerWindow in the window', () => {
    const guard = new QuotaGuard({
      windowMs: 1000,
      maxPerWindow: 2,
      maxConcurrent: 10,
    });
    expect(guard.tryAcquire('k', 0).allowed).toBe(true);
    guard.release('k');
    expect(guard.tryAcquire('k', 100).allowed).toBe(true);
    guard.release('k');
    const third = guard.tryAcquire('k', 200);
    expect(third).toEqual({ allowed: false, reason: 'rate_limited' });
  });

  it('resets the window after windowMs', () => {
    const guard = new QuotaGuard({
      windowMs: 1000,
      maxPerWindow: 1,
      maxConcurrent: 10,
    });
    expect(guard.tryAcquire('k', 0).allowed).toBe(true);
    guard.release('k');
    expect(guard.tryAcquire('k', 500).allowed).toBe(false);
    expect(guard.tryAcquire('k', 1000).allowed).toBe(true);
  });

  it('caps concurrency until release', () => {
    const guard = new QuotaGuard({
      windowMs: 60_000,
      maxPerWindow: 100,
      maxConcurrent: 2,
    });
    expect(guard.tryAcquire('k', 0).allowed).toBe(true);
    expect(guard.tryAcquire('k', 0).allowed).toBe(true);
    expect(guard.tryAcquire('k', 0)).toEqual({
      allowed: false,
      reason: 'concurrency_limited',
    });
    expect(guard.inFlight('k')).toBe(2);
    guard.release('k');
    expect(guard.inFlight('k')).toBe(1);
    expect(guard.tryAcquire('k', 0).allowed).toBe(true);
  });

  it('keys are independent', () => {
    const guard = new QuotaGuard({
      windowMs: 1000,
      maxPerWindow: 1,
      maxConcurrent: 1,
    });
    expect(guard.tryAcquire('a', 0).allowed).toBe(true);
    expect(guard.tryAcquire('b', 0).allowed).toBe(true);
  });

  it('loads config from env with safe fallbacks', () => {
    const cfg = loadQuotaConfig({
      TTS_QUOTA_WINDOW_MS: '5000',
      TTS_QUOTA_MAX_PER_WINDOW: 'bad',
      TTS_QUOTA_MAX_CONCURRENT: '8',
    });
    expect(cfg.windowMs).toBe(5000);
    expect(cfg.maxPerWindow).toBe(120); // fallback
    expect(cfg.maxConcurrent).toBe(8);
  });
});
