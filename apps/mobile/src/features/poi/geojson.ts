import type { FeatureCollection, Point } from 'geojson';

import type { PoiSummary } from './model';

interface PoiProperties {
  id: string;
  name: string;
  categoryName: string;
}

export function poisToFeatureCollection(
  pois: readonly PoiSummary[],
): FeatureCollection<Point, PoiProperties> {
  return {
    type: 'FeatureCollection',
    features: pois.map((poi) => ({
      type: 'Feature',
      id: poi.id,
      geometry: {
        type: 'Point',
        coordinates: [poi.longitude, poi.latitude],
      },
      properties: {
        id: poi.id,
        name: poi.name,
        categoryName: poi.categoryName ?? '',
      },
    })),
  };
}

export function findPoiFromMapPress(
  pois: readonly PoiSummary[],
  feature: { properties?: Record<string, unknown> | null } | undefined,
): PoiSummary | null {
  const id = feature?.properties?.id;
  return typeof id === 'string'
    ? (pois.find((poi) => poi.id === id) ?? null)
    : null;
}
