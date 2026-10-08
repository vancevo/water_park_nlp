import { createHash } from 'node:crypto';

import {
  runTtsBenchmark,
  type BenchmarkReport,
  type BenchmarkSentence,
} from '../piper/tts-benchmark.js';
import type { TtsProvider } from '../types.js';
import type { HardwareClass } from './cli-tts-provider.js';

/**
 * Multi-provider comparison harness (AI05). Runs every candidate over the SAME
 * normalized input set via the existing single-provider benchmark, then scores
 * each against pass thresholds that are fixed up front (never derived from the
 * results). Produces a provider decision record with per-locale recommendations
 * and the hardware/license constraints behind them.
 *
 * It does not pick a production winner on its own: the automated metrics are
 * operational only; natural-ness/pronunciation come from blind human review over
 * the generated audio (the blind label map below), and the full-corpus run +
 * GO decision happen at integration (I03). Privacy: only sentence ids, input
 * hashes, timings and stable error codes are stored — never transcript or audio.
 */

export interface BenchmarkThresholds {
  /** Reject a provider slower than this at p95 generation time. */
  maxP95GenerationMs: number;
  /** Reject a provider whose mean real-time factor exceeds this. */
  maxMeanRealTimeFactor: number;
  /** Reject a provider failing more than this fraction of samples (0..1). */
  maxFailureRate: number;
  /** The benchmark must cover at least this many locales to be meaningful. */
  minLocales: number;
}

/** A provider plus the metadata the base `TtsProvider` contract does not carry. */
export interface ProviderCandidate {
  provider: TtsProvider;
  hardwareClass: HardwareClass;
  license?: string;
  sourceUrl?: string;
  voiceId?: string;
}

export interface ProviderBenchmarkEntry {
  provider: string;
  model: string;
  modelVersion: string;
  hardwareClass: HardwareClass;
  license: string | null;
  sourceUrl: string | null;
  locale: string;
  count: number;
  ok: number;
  failed: number;
  failureRate: number;
  p95GenerationMs: number | null;
  meanRealTimeFactor: number | null;
  totalSizeBytes: number;
  /** True when the provider ran at least one sample and met every threshold. */
  passed: boolean;
  violations: string[];
  report: BenchmarkReport;
}

export interface BlindLabel {
  label: string;
  provider: string;
  locale: string;
  sampleId: string;
}

export interface LocaleRecommendation {
  locale: string;
  recommendedProvider: string | null;
  rationale: string;
}

export interface ProviderComparisonReport {
  schema: 'tts-provider-benchmark/v1';
  generatedAt: string;
  thresholds: BenchmarkThresholds;
  /** sha256 of each normalized input — proof every provider saw identical text. */
  inputSet: {
    id: string;
    locale: string;
    category: string | null;
    inputSha256: string;
  }[];
  providers: ProviderBenchmarkEntry[];
  /** Sealed provider↔label map for blind human rating of generated audio. */
  blindLabels: BlindLabel[];
  recommendationsByLocale: LocaleRecommendation[];
}

export interface ProviderComparisonOptions {
  thresholds: BenchmarkThresholds;
  now?: () => number;
  timestamp?: () => string;
  /** Salt for the blind-label shuffle (reproducible when fixed). */
  blindSalt?: string;
}

function normalizeInput(text: string): string {
  return text.normalize('NFC').replace(/\s+/gu, ' ').trim();
}

function sha256Hex(text: string): string {
  return createHash('sha256').update(text, 'utf8').digest('hex');
}

function evaluate(
  report: BenchmarkReport,
  thresholds: BenchmarkThresholds,
): { passed: boolean; violations: string[]; failureRate: number } {
  const violations: string[] = [];
  const failureRate = report.count > 0 ? report.failed / report.count : 1;
  if (report.count === 0) {
    violations.push('no applicable samples were run');
  }
  if (failureRate > thresholds.maxFailureRate) {
    violations.push(
      `failureRate ${failureRate.toFixed(3)} > ${thresholds.maxFailureRate}`,
    );
  }
  if (
    report.p95GenerationMs !== null &&
    report.p95GenerationMs > thresholds.maxP95GenerationMs
  ) {
    violations.push(
      `p95GenerationMs ${report.p95GenerationMs} > ${thresholds.maxP95GenerationMs}`,
    );
  }
  if (
    report.meanRealTimeFactor !== null &&
    report.meanRealTimeFactor > thresholds.maxMeanRealTimeFactor
  ) {
    violations.push(
      `meanRealTimeFactor ${report.meanRealTimeFactor.toFixed(3)} > ${thresholds.maxMeanRealTimeFactor}`,
    );
  }
  return { passed: violations.length === 0, violations, failureRate };
}

function buildBlindLabels(
  providers: readonly ProviderBenchmarkEntry[],
  salt: string,
): BlindLabel[] {
  const pairs: Omit<BlindLabel, 'label'>[] = [];
  for (const entry of providers) {
    for (const sample of entry.report.samples) {
      if (sample.ok) {
        pairs.push({
          provider: entry.provider,
          locale: entry.locale,
          sampleId: sample.id,
        });
      }
    }
  }
  // Shuffle deterministically by a salted hash so the label order hides provider.
  const ordered = pairs
    .map((p) => ({
      p,
      sort: sha256Hex(`${salt}:${p.provider}:${p.locale}:${p.sampleId}`),
    }))
    .sort((a, b) => a.sort.localeCompare(b.sort));
  return ordered.map(({ p }, index) => ({
    label: `B${String(index + 1).padStart(3, '0')}`,
    ...p,
  }));
}

function recommend(
  locale: string,
  entries: readonly ProviderBenchmarkEntry[],
): LocaleRecommendation {
  const covering = entries.filter((e) => e.locale === locale);
  const measured = covering.filter((e) => e.count > 0);
  if (measured.length === 0) {
    return {
      locale,
      recommendedProvider: null,
      rationale:
        'No measurements yet — run the benchmark locally with real engines before recommending.',
    };
  }
  const passing = measured.filter((e) => e.passed);
  const pool = passing.length > 0 ? passing : [];
  if (pool.length === 0) {
    return {
      locale,
      recommendedProvider: null,
      rationale: `No candidate met the thresholds for "${locale}"; keep the current baseline and revisit after the full-corpus run (I03).`,
    };
  }
  // Prefer the fastest passing CPU provider; GPU only if no CPU option passes.
  const cpu = pool.filter((e) => e.hardwareClass === 'cpu');
  const ranked = (cpu.length > 0 ? cpu : pool).sort(
    (a, b) =>
      (a.meanRealTimeFactor ?? Infinity) - (b.meanRealTimeFactor ?? Infinity),
  );
  const best = ranked[0]!;
  return {
    locale,
    recommendedProvider: best.provider,
    rationale:
      `${best.provider}@${best.modelVersion} (${best.hardwareClass}, license ${best.license ?? 'unknown'}) ` +
      `met all thresholds with the best mean RTF (${best.meanRealTimeFactor?.toFixed(3)}); ` +
      `provisional — confirm with blind review + full corpus at I03.`,
  };
}

export async function runProviderComparison(
  candidates: readonly ProviderCandidate[],
  sentences: readonly BenchmarkSentence[],
  options: ProviderComparisonOptions,
): Promise<ProviderComparisonReport> {
  const timestamp = options.timestamp ?? (() => new Date().toISOString());
  const salt = options.blindSalt ?? 'tts-blind';

  const inputSet = sentences.map((s) => ({
    id: s.id,
    locale: s.locale,
    category: s.category ?? null,
    inputSha256: sha256Hex(normalizeInput(s.text)),
  }));
  // Feed every provider the normalized text so inputs are provably identical.
  const normalizedSentences: BenchmarkSentence[] = sentences.map((s) => ({
    ...s,
    text: normalizeInput(s.text),
  }));

  const providers: ProviderBenchmarkEntry[] = [];
  for (const candidate of candidates) {
    const benchOptions = options.now
      ? { voiceId: candidate.voiceId ?? '', now: options.now, timestamp }
      : { voiceId: candidate.voiceId ?? '', timestamp };
    const report = await runTtsBenchmark(
      candidate.provider,
      normalizedSentences,
      benchOptions,
    );
    const { passed, violations, failureRate } = evaluate(
      report,
      options.thresholds,
    );
    providers.push({
      provider: report.provider,
      model: report.model,
      modelVersion: report.modelVersion,
      hardwareClass: candidate.hardwareClass,
      license: candidate.license ?? null,
      sourceUrl: candidate.sourceUrl ?? null,
      locale: report.locale,
      count: report.count,
      ok: report.ok,
      failed: report.failed,
      failureRate,
      p95GenerationMs: report.p95GenerationMs,
      meanRealTimeFactor: report.meanRealTimeFactor,
      totalSizeBytes: report.totalSizeBytes,
      passed,
      violations,
      report,
    });
  }

  const locales = [...new Set(inputSet.map((s) => s.locale))];
  return {
    schema: 'tts-provider-benchmark/v1',
    generatedAt: timestamp(),
    thresholds: options.thresholds,
    inputSet,
    providers,
    blindLabels: buildBlindLabels(providers, salt),
    recommendationsByLocale: locales.map((locale) =>
      recommend(locale, providers),
    ),
  };
}
