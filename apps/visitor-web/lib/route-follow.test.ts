import { describe, expect, it } from 'vitest';
import {
  EMPTY_WATCH,
  FOLLOW_DEFAULTS,
  boundsOf,
  buildRouteIndex,
  followWindow,
  holdFor,
  pointAt,
  projectOnRoute,
  sliceRoute,
  steadyProgress,
} from './route-follow';
import { geoDistanceMeters } from './route-simulation';

const LAT = 10.765;
const LON = 106.637;
const M_LAT = 1 / 110_574;
const M_LON = 1 / (111_320 * Math.cos((LAT * Math.PI) / 180));
/** A point `east` / `north` metres from the origin. */
const at = (east: number, north: number): [number, number] => [
  LON + east * M_LON,
  LAT + north * M_LAT,
];
const geo = (east: number, north: number) => ({
  longitude: at(east, north)[0],
  latitude: at(east, north)[1],
});

// 300 m east, then 200 m north: an L with a corner at 300 m.
const lShape = buildRouteIndex([
  at(0, 0),
  at(100, 0),
  at(300, 0),
  at(300, 200),
]);
// A U: 100 m east, 50 m north, 100 m back west (doubles back close to itself).
const uShape = buildRouteIndex([at(0, 0), at(100, 0), at(100, 50), at(0, 50)]);

describe('route index', () => {
  it('measures along the line, not by vertices', () => {
    expect(lShape.totalMeters).toBeGreaterThan(498);
    expect(lShape.totalMeters).toBeLessThan(502);
    expect(lShape.cumulative[1]).toBeCloseTo(100, 0);
  });

  it('finds the point at a distance, clamped to both ends', () => {
    expect(geoDistanceMeters(pointAt(lShape, 300), geo(300, 0))).toBeLessThan(
      0.5,
    );
    expect(geoDistanceMeters(pointAt(lShape, 400), geo(300, 100))).toBeLessThan(
      0.5,
    );
    expect(geoDistanceMeters(pointAt(lShape, -5), geo(0, 0))).toBeLessThan(0.5);
    expect(
      geoDistanceMeters(pointAt(lShape, 9999), geo(300, 200)),
    ).toBeLessThan(0.5);
  });
});

describe('where the visitor is on the route', () => {
  it('projects onto the line with the lateral offset', () => {
    const p = projectOnRoute(lShape, geo(150, 12))!;
    expect(p.distanceAlong).toBeCloseTo(150, 0);
    expect(p.lateralMeters).toBeCloseTo(12, 0);
  });

  it('does not jump to the later leg of a U-turn: the hint keeps it on the first leg', () => {
    // 25 m east, 25 m north: equally near the outbound and the return leg.
    const nearBoth = geo(25, 25);
    const outbound = projectOnRoute(uShape, nearBoth, 20)!;
    expect(outbound.distanceAlong).toBeLessThan(100);
    const returning = projectOnRoute(uShape, nearBoth, 200)!;
    expect(returning.distanceAlong).toBeGreaterThan(150);
  });

  it('falls back to the whole line when the visitor is far from where it expected', () => {
    const p = projectOnRoute(lShape, geo(300, 150), 10)!;
    expect(p.distanceAlong).toBeGreaterThan(440);
  });

  it('keeps progress steady against jitter but lets a real turn-around through', () => {
    expect(steadyProgress(100, 104)).toBe(104);
    expect(steadyProgress(100, 96)).toBe(96);
    expect(steadyProgress(100, 40)).toBe(70); // at most 30 m back per fix
    expect(steadyProgress(null, 40)).toBe(40);
  });
});

describe('the stretch the camera frames', () => {
  it('slices between two distances and keeps every vertex inside (the corner)', () => {
    const slice = sliceRoute(lShape, 250, 380);
    expect(slice[0]).toEqual(
      at(250, 0).map((v, i) => slice[0]![i]) as [number, number],
    );
    expect(
      slice.some(
        (c) =>
          Math.abs(c[0] - at(300, 0)[0]) < 1e-9 &&
          Math.abs(c[1] - at(300, 0)[1]) < 1e-9,
      ),
    ).toBe(true);
    const end = slice.at(-1)!;
    expect(
      geoDistanceMeters({ longitude: end[0], latitude: end[1] }, geo(300, 80)),
    ).toBeLessThan(0.5);
  });

  it('covers the bend ahead, not just the two end points (a U-turn)', () => {
    const [[west, south], [east, north]] = followWindow(
      uShape,
      80,
      geo(80, 0),
      120,
    );
    expect(north - south).toBeGreaterThan(49 * M_LAT); // includes the 50 m leg north
    // from 60 m (20 m behind) to 200 m along: x from 50 to 100 m, so ~50 m wide
    expect(east - west).toBeGreaterThan(49 * M_LON);
  });

  it('shows 80–150 m ahead whatever lookahead is asked for, or to the end when shorter', () => {
    const far = followWindow(lShape, 0, geo(0, 0), 10_000);
    const reach = geoDistanceMeters(
      { longitude: far[0][0], latitude: far[0][1] },
      { longitude: far[1][0], latitude: far[1][1] },
    );
    expect(reach).toBeLessThan(FOLLOW_DEFAULTS.maxLookAheadMeters * 1.5 + 10);
    const near = followWindow(lShape, 490, geo(300, 190), 100);
    expect(near[1][1]).toBeGreaterThanOrEqual(at(300, 199)[1]);
  });

  it('never frames less than ~50 m, so a short leg is not zoomed in absurdly', () => {
    const [[west, south], [east, north]] = boundsOf([at(0, 0), at(5, 5)]);
    expect((east - west) / M_LON).toBeGreaterThanOrEqual(49.9);
    expect((north - south) / M_LAT).toBeGreaterThanOrEqual(49.9);
  });
});

describe('leaving the route and arriving', () => {
  const holdMs = FOLLOW_DEFAULTS.offRouteMs;
  it('fires only after the condition held long enough with usable fixes', () => {
    let state = EMPTY_WATCH;
    let r = holdFor(state, true, true, 0, holdMs);
    expect(r.fired).toBe(false);
    state = r.state;
    r = holdFor(state, true, true, 4000, holdMs);
    expect(r.fired).toBe(false);
    // a poor fix neither fires nor resets
    r = holdFor(r.state, false, false, 4500, holdMs);
    expect(r.state.since).toBe(0);
    r = holdFor(r.state, true, true, 5000, holdMs);
    expect(r.fired).toBe(true);
  });

  it('resets when the visitor is back on the route', () => {
    let r = holdFor(EMPTY_WATCH, true, true, 0, holdMs);
    r = holdFor(r.state, false, true, 2000, holdMs);
    expect(r.state.since).toBeNull();
    r = holdFor(r.state, true, true, 6000, holdMs);
    expect(r.fired).toBe(false);
  });
});
