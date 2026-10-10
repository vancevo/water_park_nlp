import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  AMENITY_KINDS,
  amenityIconUrl,
  amenityKind,
  type AmenityKind,
} from './amenities';
import { formatPoiNumber, isNewPlace } from './poi-number';
import { poiPinColor } from './poi-pin-colors';

describe('amenities', () => {
  it('reads the kind from the svc- slug', () => {
    expect(amenityKind('svc-food-3')).toBe('food');
    expect(amenityKind('svc-wc-access-2')).toBe('wc-access');
    expect(amenityKind('svc-wc-8')).toBe('wc');
    expect(amenityKind('svc-first-aid')).toBe('first-aid');
    expect(amenityKind('svc-security')).toBe('security');
    expect(amenityKind('p01-gate')).toBeNull();
    expect(amenityKind('svc-unknown-1')).toBeNull();
  });

  it('is not a numbered or "New" place', () => {
    expect(isNewPlace('svc-wc-1')).toBe(false);
    expect(poiPinColor('svc-wc-1')).toBeNull();
    expect(formatPoiNumber('svc-wc-1')).toBe('·');
  });

  it('ships a sprite for every kind and the 24 service points of the map', () => {
    for (const kind of AMENITY_KINDS) {
      expect(
        existsSync(join(__dirname, '../public', amenityIconUrl(kind))),
        kind,
      ).toBe(true);
    }
    const file = JSON.parse(
      readFileSync(
        join(__dirname, '../../../data/pois/amenities.json'),
        'utf8',
      ),
    ) as { places: { slug: string; kind: AmenityKind }[] };
    expect(file.places).toHaveLength(24);
    for (const place of file.places) {
      expect(amenityKind(place.slug), place.slug).toBe(place.kind);
    }
  });
});
