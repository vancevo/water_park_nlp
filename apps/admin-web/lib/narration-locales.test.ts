import { describe, expect, it, vi } from 'vitest';
import {
  FIXTURE_NARRATION_LOCALE_CATALOG,
  canonicalLocale,
  createFixtureNarrationLocalePort,
  createHttpNarrationLocalePort,
  disabledStoredLocales,
  fallbackChain,
  localeLabel,
  narrationDataMode,
  normalizeCatalog,
} from './narration-locales';

describe('narration locale catalog port', () => {
  it('serves a VI/EN fixture in configured order without sharing state', async () => {
    const port = createFixtureNarrationLocalePort();
    const first = await port.getCatalog();
    expect(first.defaultLocale).toBe('vi');
    expect(first.locales.map((item) => item.code)).toEqual(['vi', 'en']);
    first.locales.pop();
    expect((await port.getCatalog()).locales).toHaveLength(2);
  });

  it('reads the HTTP catalog through the typed client and normalises it', async () => {
    const api = {
      getNarrationLocales: vi.fn(async () => ({
        defaultLocale: 'vi',
        locales: [
          { code: 'vi', nativeLabel: 'Tiếng Việt', speechTag: 'vi-VN' },
          {
            code: 'EN-us',
            nativeLabel: 'English',
            speechTag: 'en-US',
            fallbackLocale: 'vi',
          },
        ],
      })),
    };
    const catalog = await createHttpNarrationLocalePort(api).getCatalog();
    expect(api.getNarrationLocales).toHaveBeenCalledOnce();
    expect(catalog.locales[1]).toEqual({
      code: 'en-US',
      nativeLabel: 'English',
      speechTag: 'en-US',
      fallbackLocale: 'vi',
    });
  });

  it('drops malformed, duplicate and dangling entries and repairs the default', () => {
    const catalog = normalizeCatalog({
      defaultLocale: 'de',
      locales: [
        { code: 'not a locale!', nativeLabel: 'x', speechTag: 'x' },
        {
          code: 'en',
          nativeLabel: 'English',
          speechTag: '',
          fallbackLocale: 'de',
        },
        { code: 'en', nativeLabel: 'Duplicate', speechTag: 'en-GB' },
        {
          code: 'fr',
          nativeLabel: 'Français',
          speechTag: 'fr-FR',
          fallbackLocale: 'fr',
        },
      ],
    });
    expect(catalog).toEqual({
      defaultLocale: 'en',
      locales: [
        { code: 'en', nativeLabel: 'English', speechTag: 'en' },
        { code: 'fr', nativeLabel: 'Français', speechTag: 'fr-FR' },
      ],
    });
    expect(normalizeCatalog({} as never)).toEqual({
      defaultLocale: '',
      locales: [],
    });
  });

  it('canonicalises BCP 47 with the runtime and rejects invalid tags', () => {
    expect(canonicalLocale('zh-hant-tw')).toBe('zh-Hant-TW');
    expect(canonicalLocale(' fr ')).toBe('fr');
    expect(canonicalLocale('')).toBeNull();
    expect(canonicalLocale('123456789')).toBeNull();
  });

  it('resolves labels, fallback chains and disabled stored locales', () => {
    const catalog = FIXTURE_NARRATION_LOCALE_CATALOG;
    expect(localeLabel(catalog, 'en')).toBe('English');
    expect(localeLabel(catalog, 'de')).toBe('DE');
    expect(fallbackChain(catalog, 'en')).toEqual(['en', 'vi']);
    expect(fallbackChain(catalog, 'de')).toEqual([]);
    const cyclic = {
      defaultLocale: 'a',
      locales: [
        { code: 'a', nativeLabel: 'A', speechTag: 'a', fallbackLocale: 'b' },
        { code: 'b', nativeLabel: 'B', speechTag: 'b', fallbackLocale: 'a' },
      ],
    };
    expect(fallbackChain(cyclic, 'a')).toEqual(['a', 'b']);
    expect(
      disabledStoredLocales(catalog, [
        { locale: 'vi' },
        { locale: 'de' },
        { locale: 'ja' },
        { locale: 'de' },
      ]),
    ).toEqual(['de', 'ja']);
  });

  it('selects the fixture only for an explicit demo/test mode', () => {
    expect(narrationDataMode('demo')).toBe('demo');
    expect(narrationDataMode('test')).toBe('demo');
    expect(narrationDataMode(undefined)).toBe('api');
    expect(narrationDataMode('anything')).toBe('api');
  });
});
