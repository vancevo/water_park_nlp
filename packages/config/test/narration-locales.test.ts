import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

import {
  canonicalizeNarrationLocale,
  DEFAULT_NARRATION_LOCALE_CONFIG,
  isNarrationLocaleEnabled,
  listEnabledNarrationLocales,
  loadNarrationLocaleConfig,
  narrationLocaleFallbackChain,
  parseNarrationLocaleConfig,
} from '../src/index.js';

const validConfig = {
  defaultLocale: 'vi',
  locales: [
    {
      code: 'vi',
      nativeLabel: 'Tiếng Việt',
      speechTag: 'vi-VN',
      enabled: true,
    },
    {
      code: 'en',
      nativeLabel: 'English',
      speechTag: 'en-US',
      enabled: true,
      fallbackLocale: 'vi',
    },
    {
      code: 'fr',
      nativeLabel: 'Français',
      speechTag: 'fr-FR',
      enabled: true,
      fallbackLocale: 'en',
    },
  ],
};

describe('canonicalizeNarrationLocale', () => {
  it('canonicalises BCP 47 tags', () => {
    expect(canonicalizeNarrationLocale('EN')).toBe('en');
    expect(canonicalizeNarrationLocale('fr-fr')).toBe('fr-FR');
    expect(canonicalizeNarrationLocale(' vi ')).toBe('vi');
  });

  it('rejects invalid or empty tags', () => {
    expect(() => canonicalizeNarrationLocale('')).toThrow('non-empty');
    expect(() => canonicalizeNarrationLocale('!!')).toThrow('BCP 47');
    expect(() => canonicalizeNarrationLocale(123)).toThrow('non-empty');
  });

  it('rejects tags longer than 35 characters', () => {
    expect(() =>
      canonicalizeNarrationLocale('en-x-aaaaaaaa-bbbbbbbb-cccccccc-dddddddd'),
    ).toThrow('35 characters');
  });
});

describe('parseNarrationLocaleConfig', () => {
  it('accepts a valid config and canonicalises codes', () => {
    const config = parseNarrationLocaleConfig({
      defaultLocale: 'VI',
      locales: [
        { code: 'VI', nativeLabel: 'Tiếng Việt', speechTag: 'vi-VN' },
        {
          code: 'en',
          nativeLabel: 'English',
          speechTag: 'en-US',
          fallbackLocale: 'vi',
        },
      ],
    });
    expect(config.defaultLocale).toBe('vi');
    expect(config.locales.map((l) => l.code)).toEqual(['vi', 'en']);
    expect(config.locales[0].enabled).toBe(true);
    expect(config.locales[0].fallbackLocale).toBeNull();
  });

  it('preserves declared order', () => {
    const config = parseNarrationLocaleConfig(validConfig);
    expect(config.locales.map((l) => l.code)).toEqual(['vi', 'en', 'fr']);
  });

  it('rejects a non-object or empty locales', () => {
    expect(() => parseNarrationLocaleConfig(null)).toThrow('must be an object');
    expect(() =>
      parseNarrationLocaleConfig({ defaultLocale: 'vi', locales: [] }),
    ).toThrow('non-empty array');
  });

  it('rejects duplicate codes', () => {
    expect(() =>
      parseNarrationLocaleConfig({
        defaultLocale: 'vi',
        locales: [
          { code: 'vi', nativeLabel: 'a', speechTag: 'vi-VN' },
          { code: 'VI', nativeLabel: 'b', speechTag: 'vi-VN' },
          { code: 'en', nativeLabel: 'English', speechTag: 'en-US' },
        ],
      }),
    ).toThrow('duplicate');
  });

  it('requires defaultLocale to be listed and enabled', () => {
    expect(() =>
      parseNarrationLocaleConfig({
        defaultLocale: 'fr',
        locales: [
          { code: 'vi', nativeLabel: 'a', speechTag: 'vi-VN' },
          { code: 'en', nativeLabel: 'b', speechTag: 'en-US' },
        ],
      }),
    ).toThrow('not listed');
    expect(() =>
      parseNarrationLocaleConfig({
        defaultLocale: 'vi',
        locales: [
          { code: 'vi', nativeLabel: 'a', speechTag: 'vi-VN', enabled: false },
          { code: 'en', nativeLabel: 'b', speechTag: 'en-US' },
        ],
      }),
    ).toThrow('must be enabled');
  });

  it('validates fallback targets, self-reference and cycles', () => {
    expect(() =>
      parseNarrationLocaleConfig({
        defaultLocale: 'vi',
        locales: [
          { code: 'vi', nativeLabel: 'a', speechTag: 'vi-VN' },
          {
            code: 'en',
            nativeLabel: 'b',
            speechTag: 'en-US',
            fallbackLocale: 'de',
          },
        ],
      }),
    ).toThrow('unknown locale');
    expect(() =>
      parseNarrationLocaleConfig({
        defaultLocale: 'vi',
        locales: [
          { code: 'vi', nativeLabel: 'a', speechTag: 'vi-VN' },
          {
            code: 'en',
            nativeLabel: 'b',
            speechTag: 'en-US',
            fallbackLocale: 'en',
          },
        ],
      }),
    ).toThrow('itself');
    expect(() =>
      parseNarrationLocaleConfig({
        defaultLocale: 'vi',
        locales: [
          { code: 'vi', nativeLabel: 'a', speechTag: 'vi-VN' },
          {
            code: 'en',
            nativeLabel: 'b',
            speechTag: 'en-US',
            fallbackLocale: 'fr',
          },
          {
            code: 'fr',
            nativeLabel: 'c',
            speechTag: 'fr-FR',
            fallbackLocale: 'en',
          },
        ],
      }),
    ).toThrow('cycle');
  });

  it('rejects a fallback to a disabled locale', () => {
    expect(() =>
      parseNarrationLocaleConfig({
        defaultLocale: 'vi',
        locales: [
          { code: 'vi', nativeLabel: 'a', speechTag: 'vi-VN' },
          {
            code: 'en',
            nativeLabel: 'b',
            speechTag: 'en-US',
            fallbackLocale: 'fr',
          },
          { code: 'fr', nativeLabel: 'c', speechTag: 'fr-FR', enabled: false },
        ],
      }),
    ).toThrow('disabled');
  });

  it('requires vi and en to be present and enabled', () => {
    expect(() =>
      parseNarrationLocaleConfig({
        defaultLocale: 'fr',
        locales: [{ code: 'fr', nativeLabel: 'c', speechTag: 'fr-FR' }],
      }),
    ).toThrow('vi');
    expect(() =>
      parseNarrationLocaleConfig({
        defaultLocale: 'en',
        locales: [
          { code: 'vi', nativeLabel: 'a', speechTag: 'vi-VN', enabled: false },
          { code: 'en', nativeLabel: 'b', speechTag: 'en-US' },
        ],
      }),
    ).toThrow('backward compatibility');
  });
});

describe('helpers', () => {
  const config = parseNarrationLocaleConfig({
    defaultLocale: 'vi',
    locales: [
      { code: 'vi', nativeLabel: 'a', speechTag: 'vi-VN' },
      {
        code: 'en',
        nativeLabel: 'b',
        speechTag: 'en-US',
        fallbackLocale: 'vi',
      },
      {
        code: 'fr',
        nativeLabel: 'c',
        speechTag: 'fr-FR',
        enabled: false,
        fallbackLocale: 'en',
      },
    ],
  });

  it('lists only enabled locales in order', () => {
    expect(listEnabledNarrationLocales(config).map((l) => l.code)).toEqual([
      'vi',
      'en',
    ]);
  });

  it('reports enabled status leniently', () => {
    expect(isNarrationLocaleEnabled(config, 'EN')).toBe(true);
    expect(isNarrationLocaleEnabled(config, 'fr')).toBe(false);
    expect(isNarrationLocaleEnabled(config, 'de')).toBe(false);
    expect(isNarrationLocaleEnabled(config, '!!')).toBe(false);
  });

  it('builds the fallback chain from the requested locale', () => {
    expect(narrationLocaleFallbackChain(config, 'en')).toEqual(['en', 'vi']);
    expect(narrationLocaleFallbackChain(config, 'vi')).toEqual(['vi']);
    expect(narrationLocaleFallbackChain(config, 'fr')).toEqual([]); // disabled
    expect(narrationLocaleFallbackChain(config, 'de')).toEqual([]); // unknown
  });
});

describe('loadNarrationLocaleConfig', () => {
  it('reads and validates a configured file', () => {
    const config = loadNarrationLocaleConfig({
      configPath: 'anywhere.json',
      readFile: () => JSON.stringify(validConfig),
    });
    expect(config.locales.map((l) => l.code)).toEqual(['vi', 'en', 'fr']);
  });

  it('falls back to the built-in default when the default file is absent', () => {
    const config = loadNarrationLocaleConfig({
      readFile: () => {
        const error = new Error('missing') as NodeJS.ErrnoException;
        error.code = 'ENOENT';
        throw error;
      },
    });
    expect(config).toEqual(DEFAULT_NARRATION_LOCALE_CONFIG);
  });

  it('throws when an explicitly configured file is unreadable', () => {
    expect(() =>
      loadNarrationLocaleConfig({
        configPath: 'given.json',
        readFile: () => {
          const error = new Error('missing') as NodeJS.ErrnoException;
          error.code = 'ENOENT';
          throw error;
        },
      }),
    ).toThrow('cannot read config file');
  });

  it('throws on invalid JSON', () => {
    expect(() =>
      loadNarrationLocaleConfig({
        configPath: 'given.json',
        readFile: () => '{ not json',
      }),
    ).toThrow('not valid JSON');
  });

  it('loads and validates the shipped default config file', () => {
    const shippedPath = fileURLToPath(
      new URL('../../../config/narration-locales.json', import.meta.url),
    );
    const config = loadNarrationLocaleConfig({ configPath: shippedPath });
    expect(config.defaultLocale).toBe('vi');
    expect(config.locales.some((l) => l.code === 'vi' && l.enabled)).toBe(true);
    expect(config.locales.some((l) => l.code === 'en' && l.enabled)).toBe(true);
  });
});
