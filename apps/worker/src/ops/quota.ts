/**
 * Capacity guards (AI08): a per-key fixed-window rate limit plus a concurrency
 * cap, so a runaway caller or a flood of jobs cannot exhaust the TTS pipeline.
 * Pure and deterministic with an injected clock.
 */

export interface QuotaConfig {
  windowMs: number;
  maxPerWindow: number;
  maxConcurrent: number;
}

export const DEFAULT_QUOTA_CONFIG: QuotaConfig = {
  windowMs: 60_000,
  maxPerWindow: 120,
  maxConcurrent: 4,
};

export type QuotaDecision =
  | { allowed: true }
  | { allowed: false; reason: 'rate_limited' | 'concurrency_limited' };

interface Window {
  start: number;
  count: number;
}

export class QuotaGuard {
  private readonly windows = new Map<string, Window>();
  private readonly concurrent = new Map<string, number>();

  constructor(private readonly config: QuotaConfig = DEFAULT_QUOTA_CONFIG) {}

  /**
   * Try to admit one unit of work for `key`. On success the caller MUST call
   * {@link release} when the work finishes (success or failure).
   */
  tryAcquire(key: string, now: number = Date.now()): QuotaDecision {
    const window = this.windows.get(key);
    if (!window || now - window.start >= this.config.windowMs) {
      this.windows.set(key, { start: now, count: 0 });
    }
    const current = this.windows.get(key)!;
    if (current.count >= this.config.maxPerWindow) {
      return { allowed: false, reason: 'rate_limited' };
    }
    const inFlight = this.concurrent.get(key) ?? 0;
    if (inFlight >= this.config.maxConcurrent) {
      return { allowed: false, reason: 'concurrency_limited' };
    }
    current.count += 1;
    this.concurrent.set(key, inFlight + 1);
    return { allowed: true };
  }

  release(key: string): void {
    const inFlight = this.concurrent.get(key) ?? 0;
    if (inFlight <= 1) this.concurrent.delete(key);
    else this.concurrent.set(key, inFlight - 1);
  }

  inFlight(key: string): number {
    return this.concurrent.get(key) ?? 0;
  }
}

function positiveInt(value: string | undefined, fallback: number): number {
  const n = Number(value);
  return Number.isInteger(n) && n > 0 ? n : fallback;
}

export function loadQuotaConfig(
  env: NodeJS.ProcessEnv = process.env,
): QuotaConfig {
  return {
    windowMs: positiveInt(
      env.TTS_QUOTA_WINDOW_MS,
      DEFAULT_QUOTA_CONFIG.windowMs,
    ),
    maxPerWindow: positiveInt(
      env.TTS_QUOTA_MAX_PER_WINDOW,
      DEFAULT_QUOTA_CONFIG.maxPerWindow,
    ),
    maxConcurrent: positiveInt(
      env.TTS_QUOTA_MAX_CONCURRENT,
      DEFAULT_QUOTA_CONFIG.maxConcurrent,
    ),
  };
}
