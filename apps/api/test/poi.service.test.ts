import { describe, expect, it } from 'vitest';

import { InMemoryPoiRepository } from '../src/poi/in-memory-poi.repository.js';
import { POI_FIXTURES } from '../src/poi/poi.fixtures.js';
import { PoiService } from '../src/poi/poi.service.js';

const OPEN_TIME = () => new Date('2026-09-24T03:00:00.000Z');

describe('PoiService', () => {
  it('returns the nearby published OSM-referenced fixture', async () => {
    const service = new PoiService(new InMemoryPoiRepository(), OPEN_TIME);
    const result = await service.list({
      lat: 10.7614385239,
      lng: 106.6364528573,
      radius: 100,
      locale: 'en',
      openNow: true,
    });

    expect(result.total).toBe(1);
    expect(result.items[0]).toMatchObject({
      slug: 'lau-dai',
      name: 'The Castle',
      distanceMeters: 0,
      isOpen: true,
      fallbackUsed: false,
    });
  });

  it('falls back to Vietnamese and never returns unpublished records', async () => {
    const records = POI_FIXTURES.map((record, index) => ({
      ...record,
      status: index === 0 ? ('draft' as const) : record.status,
      translations:
        index === 1 ? { vi: record.translations.vi } : record.translations,
    }));
    const service = new PoiService(
      new InMemoryPoiRepository(records),
      OPEN_TIME,
    );
    const result = await service.list({ locale: 'en' });

    expect(result.total).toBe(4);
    expect(result.items.some((item) => item.slug === 'lau-dai')).toBe(false);
    expect(
      result.items.find((item) => item.slug === 'quang-truong-la-ma'),
    ).toMatchObject({
      requestedLocale: 'en',
      resolvedLocale: 'vi',
      fallbackUsed: true,
      name: 'Quảng trường La Mã',
    });
  });

  it('rejects incomplete spatial filters', async () => {
    const service = new PoiService(new InMemoryPoiRepository(), OPEN_TIME);
    await expect(service.list({ lat: 10.767, locale: 'vi' })).rejects.toThrow(
      'lat and lng must be provided together',
    );
    await expect(service.list({ radius: 100, locale: 'vi' })).rejects.toThrow(
      'radius requires lat and lng',
    );
  });
});
