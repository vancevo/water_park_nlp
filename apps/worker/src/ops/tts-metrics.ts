import type { TtsJobStatus } from '../tts/types.js';
import { MetricsRegistry, type Labels } from './metrics.js';

/**
 * TTS/AI operational metrics (AI08). Thin domain recorders over
 * {@link MetricsRegistry}. Every label is a low-cardinality operational field —
 * never a transcript, prompt or audio byte.
 *
 * Series:
 * - `tts_jobs_total{status,provider,model,model_version}` (counter)
 * - `tts_job_retries_total{provider,model}` (counter)
 * - `tts_job_dead_letters_total{provider,error_code}` (counter)
 * - `tts_generation_duration_ms{provider,model}` (histogram)
 * - `tts_queue_depth{status}` (gauge)
 */
export interface TtsJobLabels {
  provider: string;
  model: string;
  modelVersion: string;
}

export class TtsMetrics {
  constructor(
    private readonly registry: MetricsRegistry = new MetricsRegistry(),
  ) {}

  recordJobTransition(status: TtsJobStatus, job: TtsJobLabels): void {
    this.registry.incrementCounter('tts_jobs_total', {
      status,
      provider: job.provider,
      model: job.model,
      model_version: job.modelVersion,
    });
  }

  recordRetry(job: Pick<TtsJobLabels, 'provider' | 'model'>): void {
    this.registry.incrementCounter('tts_job_retries_total', {
      provider: job.provider,
      model: job.model,
    });
  }

  recordDeadLetter(job: { provider: string; errorCode: string | null }): void {
    this.registry.incrementCounter('tts_job_dead_letters_total', {
      provider: job.provider,
      error_code: job.errorCode ?? 'unknown',
    });
  }

  recordGenerationDuration(ms: number, job: TtsJobLabels): void {
    this.registry.observeHistogram('tts_generation_duration_ms', ms, {
      provider: job.provider,
      model: job.model,
    });
  }

  setQueueDepth(depth: number, labels: Labels = {}): void {
    this.registry.setGauge('tts_queue_depth', depth, labels);
  }

  get metrics(): MetricsRegistry {
    return this.registry;
  }
}
