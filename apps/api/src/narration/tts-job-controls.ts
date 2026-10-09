import { ConflictException, HttpException, HttpStatus } from '@nestjs/common';

/**
 * AI08 controls at the API boundary (I02-4, ADR 0013/0014).
 *
 * - Kill switch: `TTS_GENERATION_ENABLED=false` → create answers
 *   `503 AI_FEATURE_DISABLED` (poll and cancel keep working so operators can
 *   drain). The worker reads the same flag and stops claiming.
 * - Quota: a per-actor fixed window (`TTS_QUOTA_WINDOW_MS`,
 *   `TTS_QUOTA_MAX_PER_WINDOW`) → `429 rate_limited`, and a global backlog cap
 *   on queued+running jobs (`TTS_QUEUE_MAX_ACTIVE`) → `429 concurrency_limited`.
 *   The codes are the worker `QuotaDecision` reasons the admin UI already maps.
 *
 * The window counter is per API process (documented limitation; the backlog
 * cap is global because it counts rows in the shared table).
 */
export interface TtsJobControlsConfig {
  enabled: () => boolean;
  windowMs: number;
  maxPerWindow: number;
  maxActive: number;
}

export const TTS_JOB_CONTROLS = Symbol('TTS_JOB_CONTROLS');

function positiveInt(value: string | undefined, fallback: number): number {
  const n = Number(value);
  return Number.isInteger(n) && n > 0 ? n : fallback;
}

export function loadTtsJobControlsConfig(
  env: NodeJS.ProcessEnv = process.env,
): TtsJobControlsConfig {
  return {
    // Default ON; only the explicit string "false" disables (same as worker).
    enabled: () => env.TTS_GENERATION_ENABLED !== 'false',
    windowMs: positiveInt(env.TTS_QUOTA_WINDOW_MS, 60_000),
    maxPerWindow: positiveInt(env.TTS_QUOTA_MAX_PER_WINDOW, 120),
    maxActive: positiveInt(env.TTS_QUEUE_MAX_ACTIVE, 50),
  };
}

export class AiFeatureDisabledException extends HttpException {
  constructor() {
    super(
      {
        code: 'AI_FEATURE_DISABLED',
        message: 'TTS generation is temporarily disabled',
        details: null,
      },
      HttpStatus.SERVICE_UNAVAILABLE,
    );
  }
}

export class TtsQuotaExceededException extends HttpException {
  constructor(
    reason: 'rate_limited' | 'concurrency_limited',
    retryAfterSeconds: number,
  ) {
    super(
      {
        code: reason,
        message:
          reason === 'rate_limited'
            ? 'Too many TTS generation requests; retry later'
            : 'Too many TTS jobs are queued or running; retry later',
        details: { retryAfterSeconds },
      },
      HttpStatus.TOO_MANY_REQUESTS,
    );
  }
}

/** Per-actor fixed-window counter. Pure apart from the injected clock. */
export class TtsJobControls {
  private readonly windows = new Map<
    string,
    { start: number; count: number }
  >();

  constructor(
    private readonly config: TtsJobControlsConfig,
    private readonly now: () => number = () => Date.now(),
  ) {}

  assertEnabled(): void {
    if (!this.config.enabled()) throw new AiFeatureDisabledException();
  }

  /** Consume one enqueue for `actor`, or throw 429 `rate_limited`. */
  consume(actor: string): void {
    const now = this.now();
    let window = this.windows.get(actor);
    if (!window || now - window.start >= this.config.windowMs) {
      window = { start: now, count: 0 };
      this.windows.set(actor, window);
    }
    if (window.count >= this.config.maxPerWindow) {
      throw new TtsQuotaExceededException(
        'rate_limited',
        Math.max(
          1,
          Math.ceil((window.start + this.config.windowMs - now) / 1000),
        ),
      );
    }
    window.count += 1;
  }

  /** Throw 429 `concurrency_limited` when the backlog is full. */
  assertBacklog(active: number): void {
    if (active >= this.config.maxActive) {
      throw new TtsQuotaExceededException('concurrency_limited', 30);
    }
  }
}

/** 409 while a narration has a queued/running TTS job (I02-6, ADR 0014). */
export class TtsJobInProgressException extends ConflictException {
  constructor() {
    super({
      code: 'TTS_JOB_IN_PROGRESS',
      message: 'A TTS job for this narration is still queued or running',
      details: null,
    });
  }
}
