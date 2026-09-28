import type { Position } from 'geojson';

import type { LocationSample } from '../location/locationMachine';
import type { NavigationRoute } from './model';

const EARTH_RADIUS_METERS = 6_371_000;

export interface RouteMatch {
  distanceFromRouteMeters: number;
  distanceAlongRouteMeters: number;
  remainingMeters: number;
  progress: number;
  stepIndex: number;
}

function radians(degrees: number): number {
  return (degrees * Math.PI) / 180;
}

export function distanceMeters(a: Position, b: Position): number {
  const latitudeDelta = radians(b[1]! - a[1]!);
  const longitudeDelta = radians(b[0]! - a[0]!);
  const latitudeA = radians(a[1]!);
  const latitudeB = radians(b[1]!);
  const haversine =
    Math.sin(latitudeDelta / 2) ** 2 +
    Math.cos(latitudeA) *
      Math.cos(latitudeB) *
      Math.sin(longitudeDelta / 2) ** 2;
  return 2 * EARTH_RADIUS_METERS * Math.asin(Math.sqrt(haversine));
}

function localMeters(coordinate: Position, origin: Position): [number, number] {
  const latitude = radians(origin[1]!);
  return [
    radians(coordinate[0]! - origin[0]!) *
      EARTH_RADIUS_METERS *
      Math.cos(latitude),
    radians(coordinate[1]! - origin[1]!) * EARTH_RADIUS_METERS,
  ];
}

function closestOnSegment(
  point: Position,
  start: Position,
  end: Position,
): { distance: number; fraction: number } {
  const [px, py] = localMeters(point, start);
  const [ex, ey] = localMeters(end, start);
  const lengthSquared = ex * ex + ey * ey;
  const fraction =
    lengthSquared === 0
      ? 0
      : Math.max(0, Math.min(1, (px * ex + py * ey) / lengthSquared));
  return {
    distance: Math.hypot(px - fraction * ex, py - fraction * ey),
    fraction,
  };
}

export function matchRoute(
  route: NavigationRoute,
  sample: Pick<LocationSample, 'latitude' | 'longitude'>,
): RouteMatch {
  const coordinates = route.geometry.coordinates;
  const point: Position = [sample.longitude, sample.latitude];
  let traversed = 0;
  let closestDistance = Number.POSITIVE_INFINITY;
  let closestAlong = 0;

  for (let index = 0; index < coordinates.length - 1; index += 1) {
    const start = coordinates[index]!;
    const end = coordinates[index + 1]!;
    const segmentLength = distanceMeters(start, end);
    const match = closestOnSegment(point, start, end);
    if (match.distance < closestDistance) {
      closestDistance = match.distance;
      closestAlong = traversed + segmentLength * match.fraction;
    }
    traversed += segmentLength;
  }

  const geometricTotal = Math.max(traversed, 1);
  const progress = Math.max(0, Math.min(1, closestAlong / geometricTotal));
  const remainingMeters = Math.max(0, route.distanceMeters * (1 - progress));
  const completedDistance = route.distanceMeters - remainingMeters;
  let stepIndex = 0;
  let stepBoundary = route.steps[0]?.distanceMeters ?? Number.POSITIVE_INFINITY;
  while (
    stepIndex < route.steps.length - 1 &&
    completedDistance > stepBoundary
  ) {
    stepIndex += 1;
    stepBoundary += route.steps[stepIndex]!.distanceMeters;
  }

  return {
    distanceFromRouteMeters: closestDistance,
    distanceAlongRouteMeters: route.distanceMeters - remainingMeters,
    remainingMeters,
    progress,
    stepIndex,
  };
}
