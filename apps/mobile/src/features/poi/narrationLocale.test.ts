import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { afterEach, describe, expect, it, vi } from 'vitest';

import {
  InvalidNarrationLocaleError,
  isNarrationLocaleCode,
  toNarrationLocaleCode,
} from './narrationLocale';

afterEach(() => vi.restoreAllMocks());

describe('narration locale (BCP 47)', () => {
  it('accepts catalog locales beyond vi/en and canonicalises them', () => {
    expect(toNarrationLocaleCode('fr')).toBe('fr');
    expect(toNarrationLocaleCode('EN-us')).toBe('en-US');
    expect(toNarrationLocaleCode('zh-hant-tw')).toBe('zh-Hant-TW');
    expect(toNarrationLocaleCode(' pt_br ')).toBe('pt-BR');
  });

  it('rejects empty, oversized or malformed tags', () => {
    for (const value of ['', '   ', 'x'.repeat(36), 'not a locale', '12'])
      expect(() => toNarrationLocaleCode(value)).toThrow(
        InvalidNarrationLocaleError,
      );
    expect(isNarrationLocaleCode(42)).toBe(false);
    expect(isNarrationLocaleCode('fr-FR')).toBe(true);
  });

  it('falls back to shape checks when Intl.getCanonicalLocales is missing (Hermes)', () => {
    const intl = Intl as { getCanonicalLocales?: unknown };
    const original = intl.getCanonicalLocales;
    intl.getCanonicalLocales = undefined;
    try {
      expect(toNarrationLocaleCode('ZH-hant-tw')).toBe('zh-Hant-TW');
      expect(toNarrationLocaleCode('es-419')).toBe('es-419');
      expect(() => toNarrationLocaleCode('bad tag!')).toThrow(
        InvalidNarrationLocaleError,
      );
    } finally {
      intl.getCanonicalLocales = original;
    }
  });

  it('keeps vi|en assumptions out of the narration transport', () => {
    for (const file of [
      'narrationModel.ts',
      'httpNarrationClient.ts',
      'usePoiNarration.ts',
      'narrationState.ts',
    ]) {
      const source = readFileSync(join(__dirname, file), 'utf8');
      expect(source, file).not.toMatch(/SupportedLocale|'vi'\s*\|\s*'en'/);
    }
  });
});
