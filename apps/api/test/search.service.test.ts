import { describe, expect, it } from 'vitest';

import { InMemorySearchRepository } from '../src/search/in-memory-search.repository.js';
import { POI_FIXTURES } from '../src/poi/poi.fixtures.js';
import { SearchService } from '../src/search/search.service.js';
import { normalizeSearchText } from '../src/search/search-text.js';

function service() {
  return new SearchService(
    new InMemorySearchRepository(),
    () => new Date('2026-09-25T03:00:00.000Z'),
  );
}

describe('SearchService', () => {
  it('normalizes Vietnamese diacritics including đ', () => {
    expect(normalizeSearchText('Điểm Đến Ở Đầm Sen')).toBe(
      'diem den o dam sen',
    );
  });

  it('keeps an exact-name boost and supports accent-insensitive matching', async () => {
    const exact = await service().search({
      q: 'Quảng trường La Mã',
      locale: 'vi',
      limit: 20,
      offset: 0,
    });
    const normalized = await service().search({
      q: 'quang truong la ma',
      locale: 'vi',
      limit: 20,
      offset: 0,
    });

    expect(exact.items[0]?.id).toBe('00000000-0000-4000-8000-000000000102');
    expect(exact.items[0]?.reasons).toContain('exact_name');
    expect(normalized.items[0]?.id).toBe(
      '00000000-0000-4000-8000-000000000102',
    );
    expect(normalized.items[0]?.reasons).toContain('accent_insensitive_name');
    expect(exact.items[0]!.score).toBeGreaterThan(normalized.items[0]!.score);
  });

  it('applies category, open-now and radius filters with stable pagination', async () => {
    const result = await service().search({
      q: 'cinemax',
      locale: 'en',
      category: 'interactive',
      openNow: true,
      lat: 10.7679152949,
      lng: 106.6394141844,
      radius: 100,
      limit: 1,
      offset: 0,
    });

    expect(result.total).toBe(1);
    expect(result.items).toHaveLength(1);
    expect(result.items[0]?.category).toBe('interactive');
    expect(result.items[0]?.distanceMeters).toBeDefined();
    expect(result.items[0]?.reasons).toEqual(
      expect.arrayContaining(['text_match', 'nearby', 'open_now']),
    );
  });

  it('rejects incomplete spatial queries and non-searchable punctuation', async () => {
    await expect(
      service().search({
        q: 'garden',
        locale: 'en',
        lat: 10.767,
        limit: 20,
        offset: 0,
      }),
    ).rejects.toThrow('lat and lng must be provided together');
    await expect(
      service().search({
        q: '!!!',
        locale: 'vi',
        limit: 20,
        offset: 0,
      }),
    ).rejects.toThrow('q must contain letters or numbers');
  });

  it('reports a Vietnamese fallback when an English translation is absent', async () => {
    const viOnly = structuredClone(POI_FIXTURES[0]!);
    delete viOnly.translations.en;
    const fallbackService = new SearchService(
      new InMemorySearchRepository([viOnly]),
      () => new Date('2026-09-25T03:00:00.000Z'),
    );

    const result = await fallbackService.search({
      q: 'lau dai',
      locale: 'en',
      limit: 20,
      offset: 0,
    });

    expect(result.items[0]?.resolvedLocale).toBe('vi');
    expect(result.items[0]?.fallbackUsed).toBe(true);
  });
});
