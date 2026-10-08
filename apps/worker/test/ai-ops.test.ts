import { describe, expect, it } from 'vitest';

import { MetricsRegistry } from '../src/ops/metrics.js';
import { TtsMetrics } from '../src/ops/tts-metrics.js';
import {
  AiFeatureDisabledError,
  assertTtsGenerationEnabled,
  loadAiFeatureFlags,
} from '../src/ops/ai-feature-flags.js';

const JOB = { provider: 'piper', model: 'vi', modelVersion: 'v1' };

describe('TtsMetrics', () => {
  it('records job transitions, retries, dead-letters and latency', () => {
    const registry = new MetricsRegistry();
    const metrics = new TtsMetrics(registry);
    metrics.recordJobTransition('queued', JOB);
    metrics.recordJobTransition('succeeded', JOB);
    metrics.recordRetry(JOB);
    metrics.recordDeadLetter({ provider: 'piper', errorCode: 'TTS_TIMEOUT' });
    metrics.recordGenerationDuration(1200, JOB);
    metrics.setQueueDepth(7, { status: 'queued' });

    const text = registry.toPrometheus();
    expect(text).toContain(
      'tts_jobs_total{model="vi",model_version="v1",provider="piper",status="queued"} 1',
    );
    expect(text).toContain(
      'tts_job_retries_total{model="vi",provider="piper"} 1',
    );
    expect(text).toContain(
      'tts_job_dead_letters_total{error_code="TTS_TIMEOUT",provider="piper"} 1',
    );
    expect(text).toContain('tts_queue_depth{status="queued"} 7');
    expect(text).toContain(
      'tts_generation_duration_ms_count{model="vi",provider="piper"} 1',
    );
  });

  it('never stores transcript text (labels are operational only)', () => {
    const registry = new MetricsRegistry();
    new TtsMetrics(registry).recordJobTransition('running', JOB);
    expect(registry.toPrometheus()).not.toMatch(/transcript|đầm sen/iu);
  });
});

describe('AI feature flags', () => {
  it('defaults TTS generation ON', () => {
    expect(loadAiFeatureFlags({}).ttsGenerationEnabled).toBe(true);
  });

  it('kill switch disables only on the exact string "false"', () => {
    expect(
      loadAiFeatureFlags({ TTS_GENERATION_ENABLED: 'false' })
        .ttsGenerationEnabled,
    ).toBe(false);
    expect(
      loadAiFeatureFlags({ TTS_GENERATION_ENABLED: '0' }).ttsGenerationEnabled,
    ).toBe(true);
  });

  it('assert throws a stable error when disabled', () => {
    try {
      assertTtsGenerationEnabled({ ttsGenerationEnabled: false });
      throw new Error('should have thrown');
    } catch (error) {
      expect(error).toBeInstanceOf(AiFeatureDisabledError);
      expect((error as AiFeatureDisabledError).code).toBe(
        'AI_FEATURE_DISABLED',
      );
    }
    expect(() =>
      assertTtsGenerationEnabled({ ttsGenerationEnabled: true }),
    ).not.toThrow();
  });
});
