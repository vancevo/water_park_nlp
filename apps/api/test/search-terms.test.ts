import { describe, expect, it } from 'vitest';

import { searchTerms } from '../src/search/search-text.js';

describe('searchTerms (L3 lexical recall)', () => {
  it('drops function words and catalogue meta words', () => {
    expect(searchTerms('khu vườn nhiều màu cho gia đình').terms).toEqual([
      'khu',
      'vuon',
      'nhieu',
      'mau',
      'gia',
      'dinh',
    ]);
    expect(searchTerms('garden category').terms).toEqual(['garden']);
    expect(searchTerms('learn how the water cycle works').terms).toEqual([
      'learn',
      'water',
      'cycle',
      'works',
    ]);
  });

  it('requires half of the significant terms, at least one', () => {
    expect(searchTerms('zoo').minMatch).toBe(1);
    expect(searchTerms('Vườn Cầu').minMatch).toBe(1);
    // "nhà hàng pizza" must not match a POI that only contains "nhà".
    expect(searchTerms('nhà hàng pizza').minMatch).toBe(2);
    expect(searchTerms('khu vườn nhiều màu cho gia đình').minMatch).toBe(3);
  });

  it('keeps plain tokens when every word is a stopword', () => {
    expect(searchTerms('the')).toEqual({ terms: ['the'], minMatch: 1 });
  });

  it('de-duplicates and only emits tsquery-safe tokens', () => {
    const { terms } = searchTerms("Vườn vườn 'x' | & !(y)");
    expect(terms).toEqual(['vuon', 'x', 'y']);
    for (const term of terms) expect(term).toMatch(/^[a-z0-9]+$/);
  });
});
