import { describe, expect, it } from 'vitest';

import {
  buildBenchmarkProviders,
  parseBenchmarkProvidersManifest,
  BenchmarkProvidersManifestError,
} from '../src/tts/providers/benchmark-providers-manifest.js';

const CHECKSUM = 'a'.repeat(64);

function entry(
  overrides: Record<string, unknown> = {},
): Record<string, unknown> {
  return {
    provider: 'zerotts',
    model: 'zerotts-vi',
    modelVersion: 'v1.0.0',
    voiceId: 'zerotts-vi-default',
    locale: 'vi',
    license: 'Apache-2.0',
    sourceUrl: 'https://example.test/zerotts',
    checksum: CHECKSUM,
    enabled: true,
    hardwareClass: 'cpu',
    command: 'zerotts',
    argsTemplate: ['--text', '{text}', '--out', '{out}'],
    textViaStdin: false,
    ...overrides,
  };
}

describe('parseBenchmarkProvidersManifest', () => {
  it('parses a valid manifest', () => {
    const manifest = parseBenchmarkProvidersManifest({ entries: [entry()] });
    expect(manifest.entries).toHaveLength(1);
    expect(manifest.entries[0]!.hardwareClass).toBe('cpu');
  });

  it('rejects an invalid hardwareClass', () => {
    expect(() =>
      parseBenchmarkProvidersManifest({
        entries: [entry({ hardwareClass: 'tpu' })],
      }),
    ).toThrow(BenchmarkProvidersManifestError);
  });

  it('requires {out} and a transcript source in argsTemplate', () => {
    expect(() =>
      parseBenchmarkProvidersManifest({
        entries: [entry({ argsTemplate: ['--text', '{text}'] })],
      }),
    ).toThrow(/\{out\}/u);
    expect(() =>
      parseBenchmarkProvidersManifest({
        entries: [
          entry({ argsTemplate: ['--out', '{out}'], textViaStdin: false }),
        ],
      }),
    ).toThrow(/transcript/u);
  });

  it('accepts stdin transcript without {text}', () => {
    const manifest = parseBenchmarkProvidersManifest({
      entries: [
        entry({ argsTemplate: ['--out', '{out}'], textViaStdin: true }),
      ],
    });
    expect(manifest.entries[0]!.textViaStdin).toBe(true);
  });

  it('reuses registry validation to reject a bad checksum', () => {
    expect(() =>
      parseBenchmarkProvidersManifest({
        entries: [entry({ checksum: 'nope' })],
      }),
    ).toThrow();
  });

  it('excludes GPU candidates unless includeGpu is set', () => {
    const manifest = parseBenchmarkProvidersManifest({
      entries: [
        entry({ provider: 'zerotts', hardwareClass: 'cpu' }),
        entry({
          provider: 'moss-tts',
          model: 'moss-vi',
          voiceId: 'moss-vi',
          hardwareClass: 'gpu',
        }),
      ],
    });
    expect(buildBenchmarkProviders(manifest)).toHaveLength(1);
    expect(
      buildBenchmarkProviders(manifest, { includeGpu: true }),
    ).toHaveLength(2);
    const [cpu] = buildBenchmarkProviders(manifest);
    expect(cpu!.provider.provider).toBe('zerotts');
    expect(cpu!.hardwareClass).toBe('cpu');
    expect(cpu!.license).toBe('Apache-2.0');
  });

  it('skips disabled entries', () => {
    const manifest = parseBenchmarkProvidersManifest({
      entries: [entry({ enabled: false })],
    });
    expect(buildBenchmarkProviders(manifest)).toHaveLength(0);
  });
});
