import type { TtsProvider } from '../types.js';

/**
 * CPU benchmark harness for a TTS provider. Produces operational metrics
 * (real-time factor, p50/p95 generation time, size) over a sentence set.
 *
 * Privacy: the report stores only sentence ids and stable error codes — never
 * transcript text or audio bytes.
 */

export interface BenchmarkSentence {
  id: string;
  locale: string;
  text: string;
  category?: string;
}

export interface BenchmarkSampleResult {
  id: string;
  category: string | null;
  ok: boolean;
  errorCode?: string;
  generationMs?: number;
  durationSeconds?: number;
  realTimeFactor?: number;
  sizeBytes?: number;
}

export interface BenchmarkReport {
  provider: string;
  model: string;
  modelVersion: string;
  voiceId: string;
  locale: string;
  count: number;
  ok: number;
  failed: number;
  p50GenerationMs: number | null;
  p95GenerationMs: number | null;
  meanRealTimeFactor: number | null;
  totalSizeBytes: number;
  samples: BenchmarkSampleResult[];
  generatedAt: string;
}

export interface BenchmarkOptions {
  voiceId?: string;
  /** Monotonic millisecond clock (injected in tests). */
  now?: () => number;
  /** ISO timestamp for the report (injected in tests). */
  timestamp?: () => string;
}

function percentile(sorted: readonly number[], p: number): number | null {
  if (sorted.length === 0) return null;
  const rank = Math.ceil((p / 100) * sorted.length) - 1;
  const index = Math.min(sorted.length - 1, Math.max(0, rank));
  return sorted[index]!;
}

function errorCodeOf(error: unknown): string {
  if (
    typeof error === 'object' &&
    error !== null &&
    'code' in error &&
    typeof (error as { code: unknown }).code === 'string'
  ) {
    const code = (error as { code: string }).code;
    if (code.startsWith('TTS_')) return code;
  }
  return 'TTS_PROVIDER_ERROR';
}

export async function runTtsBenchmark(
  provider: TtsProvider,
  sentences: readonly BenchmarkSentence[],
  options: BenchmarkOptions = {},
): Promise<BenchmarkReport> {
  const now = options.now ?? (() => Date.now());
  const timestamp = options.timestamp ?? (() => new Date().toISOString());
  const applicable = sentences.filter((s) => provider.supportsLocale(s.locale));

  const samples: BenchmarkSampleResult[] = [];
  const generationTimes: number[] = [];
  const realTimeFactors: number[] = [];
  let totalSizeBytes = 0;

  for (const sentence of applicable) {
    const start = now();
    try {
      const result = await provider.synthesize({
        transcript: sentence.text,
        locale: sentence.locale,
        voiceId: options.voiceId ?? '',
        config: {},
        seed: null,
      });
      const generationMs = now() - start;
      const realTimeFactor =
        result.durationSeconds > 0
          ? generationMs / 1000 / result.durationSeconds
          : 0;
      generationTimes.push(generationMs);
      realTimeFactors.push(realTimeFactor);
      totalSizeBytes += result.audio.length;
      samples.push({
        id: sentence.id,
        category: sentence.category ?? null,
        ok: true,
        generationMs,
        durationSeconds: result.durationSeconds,
        realTimeFactor,
        sizeBytes: result.audio.length,
      });
    } catch (error) {
      samples.push({
        id: sentence.id,
        category: sentence.category ?? null,
        ok: false,
        errorCode: errorCodeOf(error),
      });
    }
  }

  const sortedTimes = [...generationTimes].sort((a, b) => a - b);
  const meanRealTimeFactor =
    realTimeFactors.length > 0
      ? realTimeFactors.reduce((a, b) => a + b, 0) / realTimeFactors.length
      : null;

  return {
    provider: provider.provider,
    model: provider.model,
    modelVersion: provider.modelVersion,
    voiceId: options.voiceId ?? '',
    locale: applicable[0]?.locale ?? '',
    count: applicable.length,
    ok: generationTimes.length,
    failed: applicable.length - generationTimes.length,
    p50GenerationMs: percentile(sortedTimes, 50),
    p95GenerationMs: percentile(sortedTimes, 95),
    meanRealTimeFactor,
    totalSizeBytes,
    samples,
    generatedAt: timestamp(),
  };
}
