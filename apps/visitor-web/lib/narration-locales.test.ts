import { describe, expect, it, vi } from 'vitest';
import {
  FIXTURE_NARRATION_LOCALE_CATALOG as catalog,
  NARRATION_LOCALE_STORAGE_KEY,
  createFixtureNarrationLocalePort,
  createHttpNarrationLocalePort,
  narrationFallbackNotice,
  normalizeCatalog,
  pickSpeechVoice,
  readNarrationLocalePreference,
  resolveInitialNarrationLocale,
  saveNarrationLocalePreference,
  speechTagFor,
} from './narration-locales';

function memoryStorage() {
  const values = new Map<string, string>();
  return {
    getItem: (key: string) => values.get(key) ?? null,
    setItem: (key: string, value: string) => void values.set(key, value),
  };
}
const throwingStorage = {
  getItem: () => {
    throw new Error('SecurityError');
  },
  setItem: () => {
    throw new Error('QuotaExceededError');
  },
};

describe('narration locale catalog for visitors', () => {
  it('serves VI/EN/FR fixtures and normalises the HTTP catalog', async () => {
    expect(
      (await createFixtureNarrationLocalePort().getCatalog()).locales.map(
        (item) => item.code,
      ),
    ).toEqual(['vi', 'en', 'fr']);
    const api = {
      getNarrationLocales: vi.fn(async () => ({
        defaultLocale: 'vi',
        locales: [
          { code: 'vi', nativeLabel: 'Tiếng Việt', speechTag: 'vi-VN' },
          { code: 'vi', nativeLabel: 'dup', speechTag: 'vi-VN' },
          {
            code: 'fr',
            nativeLabel: 'Français',
            speechTag: 'fr-FR',
            fallbackLocale: 'de',
          },
        ],
      })),
    };
    expect(await createHttpNarrationLocalePort(api).getCatalog()).toEqual({
      defaultLocale: 'vi',
      locales: [
        { code: 'vi', nativeLabel: 'Tiếng Việt', speechTag: 'vi-VN' },
        { code: 'fr', nativeLabel: 'Français', speechTag: 'fr-FR' },
      ],
    });
    expect(
      normalizeCatalog({ defaultLocale: 'x', locales: [] }).defaultLocale,
    ).toBe('');
  });

  it('keeps narration locale independent from the UI locale', () => {
    expect(resolveInitialNarrationLocale(catalog, 'fr', 'vi')).toBe('fr');
    expect(resolveInitialNarrationLocale(catalog, null, 'en')).toBe('en');
    expect(resolveInitialNarrationLocale(catalog, 'de', 'vi')).toBe('vi');
    expect(
      resolveInitialNarrationLocale(
        { defaultLocale: 'fr', locales: [catalog.locales[2]!] },
        null,
        'en',
      ),
    ).toBe('fr');
  });

  it('uses the catalog speech tag and falls back to the code', () => {
    expect(speechTagFor(catalog, 'fr')).toBe('fr-FR');
    expect(speechTagFor(catalog, 'ja')).toBe('ja');
  });

  it('describes a fallback only when another locale was served', () => {
    expect(
      narrationFallbackNotice(catalog, {
        requestedLocale: 'fr',
        resolvedLocale: 'en',
        fallbackUsed: true,
      }),
    ).toEqual({ requestedLabel: 'Français', resolvedLabel: 'English' });
    expect(
      narrationFallbackNotice(catalog, {
        requestedLocale: 'vi',
        resolvedLocale: 'vi',
        fallbackUsed: false,
      }),
    ).toBeNull();
    expect(narrationFallbackNotice(catalog, null)).toBeNull();
  });
});

describe('narration locale preference storage', () => {
  it('persists a canonical code and ignores invalid values', () => {
    const storage = memoryStorage();
    expect(saveNarrationLocalePreference('FR', storage)).toBe(true);
    expect(storage.getItem(NARRATION_LOCALE_STORAGE_KEY)).toBe('fr');
    expect(readNarrationLocalePreference(storage)).toBe('fr');
    expect(saveNarrationLocalePreference('not valid!', storage)).toBe(false);
    storage.setItem(NARRATION_LOCALE_STORAGE_KEY, '%%%');
    expect(readNarrationLocalePreference(storage)).toBeNull();
  });

  it('never throws when storage is blocked or missing', () => {
    expect(readNarrationLocalePreference(throwingStorage)).toBeNull();
    expect(saveNarrationLocalePreference('vi', throwingStorage)).toBe(false);
    expect(readNarrationLocalePreference(null)).toBeNull();
    expect(saveNarrationLocalePreference('vi', null)).toBe(false);
  });
});

describe('Web Speech voice selection', () => {
  const voices = [
    { lang: 'en-GB', name: 'British' },
    { lang: 'vi_VN', name: 'Vietnamese' },
    { lang: 'fr-CA', name: 'Québécois' },
  ];
  it('prefers exact tag, then same language, else null', () => {
    expect(pickSpeechVoice(voices, 'vi-VN')?.name).toBe('Vietnamese');
    expect(pickSpeechVoice(voices, 'fr-FR')?.name).toBe('Québécois');
    expect(pickSpeechVoice(voices, 'en-US')?.name).toBe('British');
    expect(pickSpeechVoice(voices, 'ja-JP')).toBeNull();
    expect(pickSpeechVoice([], 'vi-VN')).toBeNull();
  });
});
