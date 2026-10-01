import { describe, expect, it } from 'vitest';

import { TtsModelRegistry } from '../src/tts/tts-model-registry.js';
import type { TtsModelRegistryEntry } from '../src/tts/types.js';

function entry(
  overrides: Partial<TtsModelRegistryEntry> = {},
): TtsModelRegistryEntry {
  return {
    provider: 'piper',
    model: 'vi_VN-vais1000',
    modelVersion: '2026.01.0',
    voiceId: 'vi_VN-vais1000-medium',
    locale: 'vi',
    license: 'MIT',
    sourceUrl: 'https://example.test/model',
    checksum: 'a'.repeat(64),
    enabled: true,
    ...overrides,
  };
}

describe('TtsModelRegistry', () => {
  it('returns the enabled voice for a locale', () => {
    const registry = new TtsModelRegistry([
      entry(),
      entry({ locale: 'en', voiceId: 'en_US-lessac', enabled: false }),
    ]);
    expect(registry.requireForLocale('vi').voiceId).toBe(
      'vi_VN-vais1000-medium',
    );
    expect(registry.enabledForLocale('en')).toBeNull();
  });

  it('throws when no enabled voice serves the locale', () => {
    const registry = new TtsModelRegistry([entry({ enabled: false })]);
    expect(() => registry.requireForLocale('vi')).toThrow('no enabled voice');
  });

  it('rejects a missing license, bad checksum or mutable version', () => {
    expect(() => new TtsModelRegistry([entry({ license: '' })])).toThrow(
      'license',
    );
    expect(() => new TtsModelRegistry([entry({ checksum: 'nope' })])).toThrow(
      'checksum',
    );
    expect(
      () => new TtsModelRegistry([entry({ modelVersion: 'main' })]),
    ).toThrow('immutable');
  });

  it('rejects duplicate entries', () => {
    expect(() => new TtsModelRegistry([entry(), entry()])).toThrow('duplicate');
  });
});
