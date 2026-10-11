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

export type CardinalDirection = 'north' | 'east' | 'south' | 'west';
export type WalkwayLines = GeoJsonLineString['coordinates'][];
/** A cardinal direction, or a compass bearing in degrees (0 = north, 90 = east). */
export type MoveDirection = CardinalDirection | number;

const CARDINAL_BEARING: Record<CardinalDirection, number> = {
  north: 0,
  east: 90,
  south: 180,
  west: 270,
};

/**
 * The compass bearing of a controller direction as the visitor sees it on screen: "up" is where
 * the top of the map points, "right" is 90° clockwise from it. A map turned by `mapBearing`
 * (the illustrated map is turned ~267° so that gate 1 is at the bottom) has its top toward that
 * bearing, so a key press must follow the screen, not the compass.
 */
export function screenDirectionBearing(
  direction: CardinalDirection,
  mapBearing: number,
): number {
  return (((mapBearing + CARDINAL_BEARING[direction]) % 360) + 360) % 360;
}

/** Move a WGS84 point by a small distance in a cardinal direction or a compass bearing. */
export function movePointByMeters(
  point: GeoPoint,
  direction: MoveDirection,
  meters: number,
): GeoPoint {
  const safeMeters = Math.max(0, meters);
  const bearing =
    typeof direction === 'number' ? direction : CARDINAL_BEARING[direction];
  const radians = (bearing * Math.PI) / 180;
  const northMeters = Math.cos(radians) * safeMeters;
  const eastMeters = Math.sin(radians) * safeMeters;
  const latitudeRadians = (point.latitude * Math.PI) / 180;
  const latitudeDelta = (northMeters / EARTH_RADIUS_METERS) * (180 / Math.PI);
  const longitudeDelta =
    (eastMeters /
      (EARTH_RADIUS_METERS * Math.max(Math.cos(latitudeRadians), 0.000001))) *
    (180 / Math.PI);
  return {
    ...point,
    latitude: point.latitude + latitudeDelta,
    longitude: point.longitude + longitudeDelta,
  };
}

interface LocalPoint {
  x: number;
  y: number;
}

function toLocalMeters(
  origin: GeoPoint,
  coordinate: [number, number],
): LocalPoint {
  const radians = Math.PI / 180;
  return {
    x:
      (coordinate[0] - origin.longitude) *
      radians *
      EARTH_RADIUS_METERS *
      Math.cos(origin.latitude * radians),
    y: (coordinate[1] - origin.latitude) * radians * EARTH_RADIUS_METERS,
  };
}

function fromLocalMeters(origin: GeoPoint, point: LocalPoint): GeoPoint {
  const degrees = 180 / Math.PI;
  return {
    longitude:
      origin.longitude +
      (point.x /
        (EARTH_RADIUS_METERS *
          Math.max(Math.cos((origin.latitude * Math.PI) / 180), 0.000001))) *
        degrees,
    latitude: origin.latitude + (point.y / EARTH_RADIUS_METERS) * degrees,
  };
}

function closestPointOnSegment(
  point: LocalPoint,
  from: LocalPoint,
  to: LocalPoint,
): LocalPoint {
  const deltaX = to.x - from.x;
  const deltaY = to.y - from.y;
  const lengthSquared = deltaX ** 2 + deltaY ** 2;
  if (lengthSquared === 0) return from;
  const ratio = Math.min(
    1,
    Math.max(
      0,
      ((point.x - from.x) * deltaX + (point.y - from.y) * deltaY) /
        lengthSquared,
    ),
  );
  return { x: from.x + deltaX * ratio, y: from.y + deltaY * ratio };
}

function localDistance(from: LocalPoint, to: LocalPoint): number {
  return Math.hypot(to.x - from.x, to.y - from.y);
}

/** Return the nearest point on any displayed walkway, or null without paths. */
export function closestPointOnWalkways(
  point: GeoPoint,
  walkways: WalkwayLines,
): GeoPoint | null {
  let nearest: LocalPoint | null = null;
  let nearestDistance = Number.POSITIVE_INFINITY;
  const localPoint = { x: 0, y: 0 };

  for (const line of walkways) {
    for (let index = 1; index < line.length; index += 1) {
      const from = toLocalMeters(point, line[index - 1]!);
      const to = toLocalMeters(point, line[index]!);
      const candidate = closestPointOnSegment(localPoint, from, to);
      const distance = localDistance(localPoint, candidate);
      if (distance < nearestDistance) {
        nearest = candidate;
        nearestDistance = distance;
      }
    }
  }

  return nearest ? fromLocalMeters(point, nearest) : null;
}

/**
 * Project a cardinal controller step onto path segments connected to the
 * current position. This prevents jumps to a nearby parallel walkway while
 * still allowing the matching branch to be selected at an intersection.
 */
export function movePointOnWalkways(
  point: GeoPoint,
  direction: MoveDirection,
  meters: number,
  walkways: WalkwayLines,
): GeoPoint {
  const snapped = closestPointOnWalkways(point, walkways);
  if (!snapped || meters <= 0) return snapped ?? point;

  const desired = movePointByMeters(snapped, direction, meters);
  const localCurrent = { x: 0, y: 0 };
  const localDesired = toLocalMeters(snapped, [
    desired.longitude,
    desired.latitude,
  ]);
  const connectionRadius = Math.max(1, meters * 1.25);
  let best: LocalPoint | null = null;
  let bestScore = Number.POSITIVE_INFINITY;

  for (const line of walkways) {
    for (let index = 1; index < line.length; index += 1) {
      const from = toLocalMeters(snapped, line[index - 1]!);
      const to = toLocalMeters(snapped, line[index]!);
      const currentProjection = closestPointOnSegment(localCurrent, from, to);
      if (localDistance(localCurrent, currentProjection) > connectionRadius)
        continue;

      const candidate = closestPointOnSegment(localDesired, from, to);
      const directionalProgress =
        candidate.x * localDesired.x + candidate.y * localDesired.y;
      if (directionalProgress < -0.01) continue;

      const score = localDistance(candidate, localDesired);
      if (score < bestScore) {
        best = candidate;
        bestScore = score;
      }
    }
  }

  return best ? fromLocalMeters(snapped, best) : snapped;
}

/** Parse LineString/MultiLineString coordinates from the map GeoJSON. */
export function walkwayLinesFromGeoJson(value: unknown): WalkwayLines {
  if (!value || typeof value !== 'object') return [];
  const features = (value as { features?: unknown }).features;
  if (!Array.isArray(features)) return [];

  const validLine = (candidate: unknown): candidate is [number, number][] =>
    Array.isArray(candidate) &&
    candidate.length >= 2 &&
    candidate.every(
      (coordinate) =>
        Array.isArray(coordinate) &&
        coordinate.length >= 2 &&
        Number.isFinite(coordinate[0]) &&
        Number.isFinite(coordinate[1]),
    );

  const lines: WalkwayLines = [];
  for (const feature of features) {
    if (!feature || typeof feature !== 'object') continue;
    const geometry = (feature as { geometry?: unknown }).geometry;
    if (!geometry || typeof geometry !== 'object') continue;
    const { type, coordinates } = geometry as {
      type?: unknown;
      coordinates?: unknown;
    };
    if (type === 'LineString' && validLine(coordinates))
      lines.push(coordinates);
    if (type === 'MultiLineString' && Array.isArray(coordinates)) {
      coordinates.forEach((line) => {
        if (validLine(line)) lines.push(line);
      });
    }
  }
  return lines;
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
