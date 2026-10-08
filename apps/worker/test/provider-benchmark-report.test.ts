import { describe, expect, it } from 'vitest';

import {
  runProviderComparison,
  type BenchmarkThresholds,
  type ProviderCandidate,
  type ProviderComparisonReport,
} from '../src/tts/providers/provider-benchmark.js';
import { validateProviderComparisonReport } from '../src/tts/providers/provider-benchmark-report.js';
import type { TtsProvider, TtsSynthesisResult } from '../src/tts/types.js';

const THRESHOLDS: BenchmarkThresholds = {
  maxP95GenerationMs: 15_000,
  maxMeanRealTimeFactor: 2,
  maxFailureRate: 0,
  minLocales: 2,
};

function fake(name: string, locale: string): ProviderCandidate {
  const provider: TtsProvider = {
    provider: name,
    model: `${name}-model`,
    modelVersion: 'v1.0.0',
    supportsLocale: (l) => l === locale,
    synthesize: async (): Promise<TtsSynthesisResult> => ({
      audio: new Uint8Array(1000),
      mimeType: 'audio/wav',
      durationSeconds: 2,
      sampleRateHz: 22_050,
    }),
  };
  return {
    provider,
    hardwareClass: 'cpu',
    license: 'MIT',
    sourceUrl: 'https://example.test',
    voiceId: name,
  };
}

const SENTENCES = [
  { id: 'vi-1', locale: 'vi', text: 'Đầm Sen.' },
  { id: 'en-1', locale: 'en', text: 'Dam Sen.' },
];

async function validReport(): Promise<ProviderComparisonReport> {
  return runProviderComparison(
    [fake('piper', 'vi'), fake('eng', 'en')],
    SENTENCES,
    {
      thresholds: THRESHOLDS,
      timestamp: () => '2026-10-08T00:00:00.000Z',
    },
  );
}

describe('validateProviderComparisonReport', () => {
  it('passes a well-formed report', async () => {
    expect(validateProviderComparisonReport(await validReport())).toEqual([]);
  });

  it('flags a missing license', async () => {
    const report = structuredClone(await validReport());
    report.providers[0]!.license = null;
    expect(
      validateProviderComparisonReport(report).some((v) =>
        v.includes('missing its license'),
      ),
    ).toBe(true);
  });

  it('flags an unpinned model version', async () => {
    const report = structuredClone(await validReport());
    report.providers[0]!.modelVersion = 'latest';
    expect(
      validateProviderComparisonReport(report).some((v) =>
        v.includes('immutable modelVersion'),
      ),
    ).toBe(true);
  });

  it('flags too few locales for the threshold', async () => {
    const report = structuredClone(await validReport());
    report.thresholds.minLocales = 5;
    expect(
      validateProviderComparisonReport(report).some((v) =>
        v.includes('minLocales'),
      ),
    ).toBe(true);
  });

  it('flags a provider that ran a different input set', async () => {
    const report = structuredClone(await validReport());
    report.providers[0]!.report.samples = [];
    expect(
      validateProviderComparisonReport(report).some((v) =>
        v.includes('missing input'),
      ),
    ).toBe(true);
  });

  it('flags transcript leakage in a sample', async () => {
    const report = structuredClone(await validReport());
    (
      report.providers[0]!.report.samples[0] as unknown as Record<
        string,
        unknown
      >
    ).text = 'leaked';
    expect(
      validateProviderComparisonReport(report).some((v) =>
        v.includes('leaks transcript'),
      ),
    ).toBe(true);
  });
});
