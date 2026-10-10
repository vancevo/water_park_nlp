import type { GeoJsonLineString, GeoPoint } from '@damsen/shared-types';
import { geoDistanceMeters } from './route-simulation';

/**
 * Pure helpers for guiding along a route: where the visitor is on it (distance along the line,
 * never by vertex count), the stretch ahead that the camera should show, when they have left
 * the route and when they have arrived. The camera itself lives in components/use-route-camera.
 */
type Coordinate = GeoJsonLineString['coordinates'][number];

export const FOLLOW_DEFAULTS = {
  /** Metres of route kept in view behind the visitor… */
  behindMeters: 20,
  /** …and ahead: starts here, clamped to the range below. */
  lookAheadMeters: 100,
  minLookAheadMeters: 80,
  maxLookAheadMeters: 150,
  /** Never frame less than this (metres across), so a short leg is not zoomed in absurdly. */
  minCoverMeters: 50,
  /** Left the route: further than this for this long, with a usable fix. */
  offRouteMeters: 25,
  offRouteMs: 5000,
  /** Fixes worse than this (metres) never decide off-route or arrival. */
  maxAccuracyMeters: 40,
  /** A fix older than this (ms) is stale and decides nothing. */
  maxFixAgeMs: 10_000,
  /** Arrived: within this of the route end (the entrance) for this long. */
  arriveMeters: 20,
  arriveMs: 2000,
  /** Progress may fall back by at most this much per fix (a real turn-around, not jitter). */
  maxBackwardMeters: 30,
  /** Camera: only move for at least this much zoom change… */
  zoomThreshold: 0.25,
  /** …or when the visitor leaves the inner part of the usable map (fraction). */
  safeZone: 0.7,
} as const;

export interface RouteIndex {
  coordinates: Coordinate[];
  /** Distance from the start to each vertex (metres). */
  cumulative: number[];
  totalMeters: number;
}

export function buildRouteIndex(
  coordinates: GeoJsonLineString['coordinates'],
): RouteIndex {
  const cumulative = [0];
  for (let i = 1; i < coordinates.length; i += 1) {
    const from = coordinates[i - 1]!;
    const to = coordinates[i]!;
    cumulative.push(
      cumulative[i - 1]! +
        geoDistanceMeters(
          { longitude: from[0], latitude: from[1] },
          { longitude: to[0], latitude: to[1] },
        ),
    );
  }
  return {
    coordinates: [...coordinates],
    cumulative,
    totalMeters: cumulative.at(-1) ?? 0,
  };
}

/** Metres per degree at this latitude, for small local projections. */
function metersPerDegree(latitude: number) {
  const radians = (latitude * Math.PI) / 180;
  return { lon: 111_320 * Math.cos(radians), lat: 110_574 };
}

export interface Projection {
  /** Distance from the route start to the closest point on the line. */
  distanceAlong: number;
  /** How far the visitor is from the line (metres). */
  lateralMeters: number;
  position: GeoPoint;
  segment: number;
}

function projectSegment(
  index: RouteIndex,
  segment: number,
  point: GeoPoint,
): Projection {
  const a = index.coordinates[segment]!;
  const b = index.coordinates[segment + 1]!;
  const scale = metersPerDegree(point.latitude);
  const ax = (a[0] - point.longitude) * scale.lon;
  const ay = (a[1] - point.latitude) * scale.lat;
  const bx = (b[0] - point.longitude) * scale.lon;
  const by = (b[1] - point.latitude) * scale.lat;
  const dx = bx - ax;
  const dy = by - ay;
  const lengthSquared = dx * dx + dy * dy;
  const t =
    lengthSquared === 0
      ? 0
      : Math.min(1, Math.max(0, -(ax * dx + ay * dy) / lengthSquared));
  const px = ax + dx * t;
  const py = ay + dy * t;
  const segmentLength =
    index.cumulative[segment + 1]! - index.cumulative[segment]!;
  return {
    distanceAlong: index.cumulative[segment]! + segmentLength * t,
    lateralMeters: Math.hypot(px, py),
    position: {
      longitude: a[0] + (b[0] - a[0]) * t,
      latitude: a[1] + (b[1] - a[1]) * t,
    },
    segment,
  };
}

/**
 * Where on the route the fix is. Prefers the part of the line around the previous progress
 * (`hintMeters`) so a loop or a route that doubles back does not make the visitor jump to a
 * later leg; falls back to the whole line when the visitor is clearly somewhere else.
 */
export function projectOnRoute(
  index: RouteIndex,
  point: GeoPoint,
  hintMeters: number | null = null,
  options: {
    windowBehind?: number;
    windowAhead?: number;
    slackMeters?: number;
  } = {},
): Projection | null {
  if (index.coordinates.length < 2) return null;
  const {
    windowBehind = FOLLOW_DEFAULTS.maxBackwardMeters,
    windowAhead = 150,
    slackMeters = 12,
  } = options;
  let best: Projection | null = null;
  let bestNear: Projection | null = null;
  for (let segment = 0; segment < index.coordinates.length - 1; segment += 1) {
    const candidate = projectSegment(index, segment, point);
    if (!best || candidate.lateralMeters < best.lateralMeters) best = candidate;
    if (
      hintMeters !== null &&
      candidate.distanceAlong >= hintMeters - windowBehind &&
      candidate.distanceAlong <= hintMeters + windowAhead &&
      (!bestNear || candidate.lateralMeters < bestNear.lateralMeters)
    ) {
      bestNear = candidate;
    }
  }
  if (
    bestNear &&
    best &&
    bestNear.lateralMeters <= best.lateralMeters + slackMeters
  ) {
    return bestNear;
  }
  return best;
}

/** The point at `meters` along the line (clamped). */
export function pointAt(index: RouteIndex, meters: number): GeoPoint {
  const target = Math.min(Math.max(0, meters), index.totalMeters);
  for (let i = 1; i < index.coordinates.length; i += 1) {
    if (index.cumulative[i]! >= target) {
      const span = index.cumulative[i]! - index.cumulative[i - 1]!;
      const ratio = span === 0 ? 0 : (target - index.cumulative[i - 1]!) / span;
      const a = index.coordinates[i - 1]!;
      const b = index.coordinates[i]!;
      return {
        longitude: a[0] + (b[0] - a[0]) * ratio,
        latitude: a[1] + (b[1] - a[1]) * ratio,
      };
    }
  }
  const last = index.coordinates.at(-1)!;
  return { longitude: last[0], latitude: last[1] };
}

/**
 * The route between two distances along it, every vertex included (a bend or a U-turn inside
 * the stretch must stay inside the bounds), with interpolated ends.
 */
export function sliceRoute(
  index: RouteIndex,
  fromMeters: number,
  toMeters: number,
): Coordinate[] {
  const from = Math.min(Math.max(0, fromMeters), index.totalMeters);
  const to = Math.min(Math.max(from, toMeters), index.totalMeters);
  const start = pointAt(index, from);
  const out: Coordinate[] = [[start.longitude, start.latitude]];
  for (let i = 0; i < index.coordinates.length; i += 1) {
    const at = index.cumulative[i]!;
    if (at > from && at < to) out.push(index.coordinates[i]!);
  }
  const end = pointAt(index, to);
  out.push([end.longitude, end.latitude]);
  return out;
}

export type Bounds = [[number, number], [number, number]];

export function boundsOf(
  coordinates: readonly Coordinate[],
  minCoverMeters = FOLLOW_DEFAULTS.minCoverMeters,
): Bounds {
  const lngs = coordinates.map((c) => c[0]);
  const lats = coordinates.map((c) => c[1]);
  let west = Math.min(...lngs);
  let east = Math.max(...lngs);
  let south = Math.min(...lats);
  let north = Math.max(...lats);
  // A tiny stretch: grow around its centre so the camera does not zoom in absurdly far.
  const centreLat = (south + north) / 2;
  const scale = metersPerDegree(centreLat);
  const widthMeters = (east - west) * scale.lon;
  const heightMeters = (north - south) * scale.lat;
  if (widthMeters < minCoverMeters) {
    const grow = (minCoverMeters - widthMeters) / 2 / scale.lon;
    west -= grow;
    east += grow;
  }
  if (heightMeters < minCoverMeters) {
    const grow = (minCoverMeters - heightMeters) / 2 / scale.lat;
    south -= grow;
    north += grow;
  }
  return [
    [west, south],
    [east, north],
  ];
}

/** What the camera should frame while following: the visitor and the stretch ahead. */
export function followWindow(
  index: RouteIndex,
  distanceAlong: number,
  position: GeoPoint,
  lookAheadMeters: number = FOLLOW_DEFAULTS.lookAheadMeters,
): Bounds {
  const ahead = Math.min(
    FOLLOW_DEFAULTS.maxLookAheadMeters,
    Math.max(FOLLOW_DEFAULTS.minLookAheadMeters, lookAheadMeters),
  );
  const slice = sliceRoute(
    index,
    distanceAlong - FOLLOW_DEFAULTS.behindMeters,
    distanceAlong + ahead,
  );
  slice.push([position.longitude, position.latitude]);
  return boundsOf(slice);
}

/** Progress that does not jump around: forward freely, backward only a little per fix. */
export function steadyProgress(
  previous: number | null,
  measured: number,
  maxBackwardMeters: number = FOLLOW_DEFAULTS.maxBackwardMeters,
): number {
  if (previous === null) return measured;
  return measured >= previous
    ? measured
    : Math.max(measured, previous - maxBackwardMeters);
}

export interface WatchState {
  /** Since when the condition has held (ms), or null. */
  since: number | null;
}

export const EMPTY_WATCH: WatchState = { since: null };

/** Condition held continuously for `holdMs`? A bad fix neither starts nor stops it. */
export function holdFor(
  state: WatchState,
  condition: boolean,
  usable: boolean,
  nowMs: number,
  holdMs: number,
): { state: WatchState; fired: boolean } {
  if (!usable) return { state, fired: false };
  if (!condition) return { state: EMPTY_WATCH, fired: false };
  const since = state.since ?? nowMs;
  return { state: { since }, fired: nowMs - since >= holdMs };
}

export function isUsableFix(accuracyMeters: number): boolean {
  return accuracyMeters <= FOLLOW_DEFAULTS.maxAccuracyMeters;
}
