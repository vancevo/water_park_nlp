import { describe, expect, it } from 'vitest';

import { findPoiFromMapPress, poisToFeatureCollection } from './geojson';
import type { PoiSummary } from './model';

const poi: PoiSummary = {
  id: 'poi-1',
  name: 'Vườn chim',
  description: null,
  categoryName: 'Thiên nhiên',
  latitude: 10.7,
  longitude: 106.6,
  imageUrl: null,
  isOpen: true,
};

describe('POI GeoJSON helpers', () => {
  it('writes GeoJSON coordinates in longitude-latitude order', () => {
    const collection = poisToFeatureCollection([poi]);

    expect(collection.features[0]?.geometry.coordinates).toEqual([106.6, 10.7]);
  });

  it('resolves a selected map feature through its stable id', () => {
    expect(findPoiFromMapPress([poi], { properties: { id: 'poi-1' } })).toBe(
      poi,
    );
    expect(
      findPoiFromMapPress([poi], { properties: { id: 'missing' } }),
    ).toBeNull();
  });
});
