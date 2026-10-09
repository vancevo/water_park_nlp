import { describe, expect, it } from 'vitest';
import {
  UI_LOCALE_STORAGE_KEY,
  readUiLocalePreference,
  saveUiLocalePreference,
  uiText,
} from './ui-text';
import { categoryLabel, formatDistance, formatDuration } from './format';

describe('visitor UI text', () => {
  it('has the same keys in Vietnamese and English', () => {
    const vi = uiText('vi');
    const en = uiText('en');
    expect(Object.keys(en).sort()).toEqual(Object.keys(vi).sort());
    expect(Object.keys(en.categories).sort()).toEqual(
      Object.keys(vi.categories).sort(),
    );
  });

  it('translates every plain string (English differs from Vietnamese)', () => {
    const vi = uiText('vi');
    const en = uiText('en');
    const brandLike = new Set(['email']);
    for (const [key, value] of Object.entries(vi)) {
      if (typeof value !== 'string' || brandLike.has(key)) continue;
      expect(en[key as keyof typeof en], key).not.toBe(value);
    }
  });

  it('interpolates counts, percentages and language names', () => {
    expect(uiText('en').placeCount(1)).toBe('1 place');
    expect(uiText('en').placeCount(3)).toBe('3 places');
    expect(uiText('vi').placeCount(3)).toBe('3 địa điểm');
    expect(uiText('en').walking(40)).toBe('Walking · 40%');
    expect(uiText('en').usingFallback('Vietnamese', 'French')).toContain(
      'Vietnamese',
    );
    expect(uiText('vi').noNarrationFor('Français', 'English')).toContain(
      'Français',
    );
  });

  it('formats distance, duration and categories per locale', () => {
    expect(formatDistance(undefined, 'en')).toBe('Unknown');
    expect(formatDuration(610, 'en')).toBe('10 min');
    expect(categoryLabel('garden', 'en')).toBe('Garden');
    expect(categoryLabel('garden', 'vi')).toBe('Vườn cảnh');
    expect(categoryLabel('unknown', 'en')).toBe('unknown');
  });
});

describe('UI locale preference', () => {
  const memory = () => {
    const data = new Map<string, string>();
    return {
      getItem: (key: string) => data.get(key) ?? null,
      setItem: (key: string, value: string) => void data.set(key, value),
    };
  };

  it('round-trips a valid locale and ignores junk', () => {
    const store = memory();
    expect(readUiLocalePreference(store)).toBeNull();
    saveUiLocalePreference('en', store);
    expect(readUiLocalePreference(store)).toBe('en');
    store.setItem(UI_LOCALE_STORAGE_KEY, 'fr');
    expect(readUiLocalePreference(store)).toBeNull();
  });

  it('survives blocked storage', () => {
    const blocked = {
      getItem: () => {
        throw new Error('blocked');
      },
      setItem: () => {
        throw new Error('blocked');
      },
    };
    expect(readUiLocalePreference(blocked)).toBeNull();
    expect(() => saveUiLocalePreference('en', blocked)).not.toThrow();
  });
});
