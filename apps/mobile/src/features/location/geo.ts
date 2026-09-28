import type { Feature, Polygon } from 'geojson';

const EARTH_RADIUS_METERS = 6_371_000;

export function accuracyCircle(
  latitude: number,
  longitude: number,
  radiusMeters: number,
  steps = 48,
): Feature<Polygon> {
  const latitudeRadians = (latitude * Math.PI) / 180;
  const coordinates: [number, number][] = [];

  for (let index = 0; index <= steps; index += 1) {
    const angle = (index / steps) * Math.PI * 2;
    const north = Math.sin(angle) * radiusMeters;
    const east = Math.cos(angle) * radiusMeters;
    const latitudeOffset = (north / EARTH_RADIUS_METERS) * (180 / Math.PI);
    const longitudeOffset =
      (east / (EARTH_RADIUS_METERS * Math.cos(latitudeRadians))) *
      (180 / Math.PI);
    coordinates.push([longitude + longitudeOffset, latitude + latitudeOffset]);
  }

  return {
    type: 'Feature',
    properties: {},
    geometry: { type: 'Polygon', coordinates: [coordinates] },
  };
}
