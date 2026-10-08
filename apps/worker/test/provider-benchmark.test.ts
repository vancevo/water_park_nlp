import { createHash } from 'node:crypto';

import { describe, expect, it } from 'vitest';

import {
  runProviderComparison,
  type BenchmarkThresholds,
  type ProviderCandidate,
} from '../src/tts/providers/provider-benchmark.js';
import type { TtsProvider, TtsSynthesisResult } from '../src/tts/types.js';

const THRESHOLDS: BenchmarkThresholds = {
  maxP95GenerationMs: 15_000,
  maxMeanRealTimeFactor: 2,
  maxFailureRate: 0,
  minLocales: 2,
};

const TS = () => '2026-10-08T00:00:00.000Z';

function fake(
  name: string,
  locale: string,
  options: { fail?: boolean; durationSeconds?: number } = {},
): ProviderCandidate {
  const provider: TtsProvider = {
    provider: name,
    model: `${name}-model`,
    modelVersion: 'v1.0.0',
    supportsLocale: (l) => l === locale,
    synthesize: async (): Promise<TtsSynthesisResult> => {
      if (options.fail)
        throw Object.assign(new Error('boom'), { code: 'TTS_PROVIDER_ERROR' });
      return {
        audio: new Uint8Array(1000),
        mimeType: 'audio/wav',
        durationSeconds: options.durationSeconds ?? 2,
        sampleRateHz: 22_050,
      };
    },
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
  { id: 'vi-1', locale: 'vi', category: 'poi-name', text: 'Đầm   Sen  một.' },
  { id: 'vi-2', locale: 'vi', category: 'long', text: 'Đầm Sen hai.' },
  { id: 'en-1', locale: 'en', category: 'poi-name', text: 'Dam Sen.' },
];

describe('runProviderComparison', () => {
  it('scores passing providers and recommends one per locale', async () => {
    const report = await runProviderComparison(
      [fake('piper', 'vi'), fake('zerotts', 'vi'), fake('anglophone', 'en')],
      SENTENCES,
      { thresholds: THRESHOLDS, timestamp: TS, blindSalt: 'x' },
    );

    expect(report.schema).toBe('tts-provider-benchmark/v1');
    expect(report.providers).toHaveLength(3);
    expect(report.providers.every((p) => p.passed)).toBe(true);

    // vi providers each ran the two vi sentences; en provider ran the one en.
    const vi = report.providers.filter((p) => p.locale === 'vi');
    expect(vi.every((p) => p.count === 2)).toBe(true);

    const viRec = report.recommendationsByLocale.find((r) => r.locale === 'vi');
    expect(['piper', 'zerotts']).toContain(viRec?.recommendedProvider);
    const enRec = report.recommendationsByLocale.find((r) => r.locale === 'en');
    expect(enRec?.recommendedProvider).toBe('anglophone');
  });

  it('hashes the normalized input and feeds every provider the same text', async () => {
    const report = await runProviderComparison(
      [fake('piper', 'vi')],
      SENTENCES,
      {
        thresholds: { ...THRESHOLDS, minLocales: 1 },
        timestamp: TS,
      },
    );
    const expected = createHash('sha256')
      .update('Đầm Sen một.', 'utf8')
      .digest('hex');
    expect(report.inputSet.find((s) => s.id === 'vi-1')?.inputSha256).toBe(
      expected,
    );
  });

  it('builds anonymous blind labels for every ok sample', async () => {
    const report = await runProviderComparison(
      [fake('piper', 'vi'), fake('zerotts', 'vi')],
      SENTENCES,
      { thresholds: { ...THRESHOLDS, minLocales: 1 }, timestamp: TS },
    );
    // 2 providers x 2 vi samples = 4 ok samples.
    expect(report.blindLabels).toHaveLength(4);
    expect(report.blindLabels.every((b) => /^B\d{3}$/.test(b.label))).toBe(
      true,
    );
    expect(new Set(report.blindLabels.map((b) => b.label)).size).toBe(4);
  });

  it('fails a provider that errors and recommends none', async () => {
    const report = await runProviderComparison(
      [fake('bad', 'vi', { fail: true })],
      SENTENCES.filter((s) => s.locale === 'vi'),
      { thresholds: { ...THRESHOLDS, minLocales: 1 }, timestamp: TS },
    );
    const p = report.providers[0]!;
    expect(p.passed).toBe(false);
    expect(p.failed).toBe(2);
    expect(p.failureRate).toBe(1);
    const rec = report.recommendationsByLocale.find((r) => r.locale === 'vi');
    expect(rec?.recommendedProvider).toBeNull();
  });

  it('fails a provider slower than the p95 threshold', async () => {
    let i = 0;
    const times = [0, 500, 1000, 1500]; // 500ms per sentence
    const report = await runProviderComparison(
      [fake('slow', 'vi')],
      SENTENCES.filter((s) => s.locale === 'vi'),
      {
        thresholds: {
          maxP95GenerationMs: 100,
          maxMeanRealTimeFactor: 2,
          maxFailureRate: 0,
          minLocales: 1,
        },
        now: () => times[i++]!,
        timestamp: TS,
      },
    );
    const p = report.providers[0]!;
    expect(p.p95GenerationMs).toBe(500);
    expect(p.passed).toBe(false);
    expect(p.violations.some((v) => v.includes('p95GenerationMs'))).toBe(true);
  });
});
