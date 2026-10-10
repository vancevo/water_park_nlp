import type { GeoPoint, GeoJsonLineString } from '@damsen/shared-types';

const EARTH_RADIUS_METERS = 6_371_008.8;
export const SIMULATION_DURATION_MS = 5_000;
/** The walker's pace: slow enough to watch the camera follow (about 6× a stroll). */
export const SIMULATION_SPEED_MPS = 8;
export const SIMULATION_MIN_MS = 15_000;
export const SIMULATION_MAX_MS = 100_000;

/** How long the simulated walk takes: the route length at the walker's pace, within limits. */
export function simulationDurationMs(totalMeters: number): number {
  return Math.min(
    SIMULATION_MAX_MS,
    Math.max(SIMULATION_MIN_MS, (totalMeters / SIMULATION_SPEED_MPS) * 1000),
  );
}

export interface RouteProgress {
  position: GeoPoint;
  traveledMeters: number;
  remainingMeters: number;
  totalMeters: number;
  complete: boolean;
}

function distanceMeters(
  from: GeoJsonLineString['coordinates'][number],
  to: GeoJsonLineString['coordinates'][number],
): number {
  const radians = Math.PI / 180;
  const latitudeDelta = (to[1] - from[1]) * radians;
  const longitudeDelta = (to[0] - from[0]) * radians;
  const value =
    Math.sin(latitudeDelta / 2) ** 2 +
    Math.cos(from[1] * radians) *
      Math.cos(to[1] * radians) *
      Math.sin(longitudeDelta / 2) ** 2;
  return (
    EARTH_RADIUS_METERS * 2 * Math.atan2(Math.sqrt(value), Math.sqrt(1 - value))
  );
}

/** Haversine distance between two WGS84 points, in metres. */
export function geoDistanceMeters(from: GeoPoint, to: GeoPoint): number {
  return distanceMeters(
    [from.longitude, from.latitude],
    [to.longitude, to.latitude],
  );
}

export function routeLengthMeters(
  coordinates: GeoJsonLineString['coordinates'],
): number {
  return coordinates.slice(1).reduce((total, coordinate, index) => {
    return total + distanceMeters(coordinates[index]!, coordinate);
  }, 0);
}

export function simulationDistanceAtTime(
  totalMeters: number,
  elapsedMs: number,
  durationMs = SIMULATION_DURATION_MS,
): number {
  if (totalMeters <= 0 || durationMs <= 0) return Math.max(0, totalMeters);
  const progress = Math.min(Math.max(0, elapsedMs / durationMs), 1);
  return totalMeters * progress;
}

export function routeProgressAt(
  coordinates: GeoJsonLineString['coordinates'],
  requestedMeters: number,
): RouteProgress | null {
  const first = coordinates[0];
  if (!first) return null;

  const totalMeters = routeLengthMeters(coordinates);
  const traveledMeters = Math.min(Math.max(0, requestedMeters), totalMeters);
  if (coordinates.length === 1 || totalMeters === 0) {
    return {
      position: { longitude: first[0], latitude: first[1] },
      traveledMeters: 0,
      remainingMeters: 0,
      totalMeters,
      complete: true,
    };
  }

  let traversed = 0;
  for (let index = 1; index < coordinates.length; index += 1) {
    const from = coordinates[index - 1]!;
    const to = coordinates[index]!;
    const segmentMeters = distanceMeters(from, to);
    if (segmentMeters === 0) continue;
    if (traversed + segmentMeters >= traveledMeters) {
      const ratio = (traveledMeters - traversed) / segmentMeters;
      return {
        position: {
          longitude: from[0] + (to[0] - from[0]) * ratio,
          latitude: from[1] + (to[1] - from[1]) * ratio,
        },
        traveledMeters,
        remainingMeters: totalMeters - traveledMeters,
        totalMeters,
        complete: traveledMeters >= totalMeters,
      };
    }
    traversed += segmentMeters;
  }

  const last = coordinates.at(-1)!;
  return {
    position: { longitude: last[0], latitude: last[1] },
    traveledMeters: totalMeters,
    remainingMeters: 0,
    totalMeters,
    complete: true,
  };
}
