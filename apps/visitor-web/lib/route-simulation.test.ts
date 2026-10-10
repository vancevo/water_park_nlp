import { describe, expect, it } from 'vitest';
import {
  closestPointOnWalkways,
  movePointByMeters,
  movePointOnWalkways,
  routeLengthMeters,
  routeProgressAt,
  simulationDistanceAtTime,
  simulationDurationMs,
  walkwayLinesFromGeoJson,
} from './route-simulation';

const route: [number, number][] = [
  [106.64, 10.76],
  [106.6401, 10.76],
  [106.6401, 10.7601],
];

describe('route simulation', () => {
  it('moves a simulated point by a cardinal distance', () => {
    const start = { latitude: 10.767, longitude: 106.638 };
    const north = movePointByMeters(start, 'north', 2);
    const west = movePointByMeters(start, 'west', 2);

    expect(north.latitude).toBeGreaterThan(start.latitude);
    expect(north.longitude).toBe(start.longitude);
    expect(
      routeLengthMeters([
        [start.longitude, start.latitude],
        [north.longitude, north.latitude],
      ]),
    ).toBeCloseTo(2, 5);
    expect(west.longitude).toBeLessThan(start.longitude);
    expect(west.latitude).toBe(start.latitude);
  });

  it('does not move for a negative controller distance', () => {
    const start = { latitude: 10.767, longitude: 106.638 };
    expect(movePointByMeters(start, 'east', -2)).toEqual(start);
  });

  it('snaps placement and controller movement onto a walkway', () => {
    const walkways: [number, number][][] = [
      [
        [106.64, 10.76],
        [106.6401, 10.76],
      ],
    ];
    const offPath = { latitude: 10.76003, longitude: 106.64002 };
    const snapped = closestPointOnWalkways(offPath, walkways)!;
    const moved = movePointOnWalkways(offPath, 'east', 2, walkways);

    expect(snapped.latitude).toBeCloseTo(10.76, 8);
    expect(moved.latitude).toBeCloseTo(10.76, 8);
    expect(moved.longitude).toBeGreaterThan(snapped.longitude);
    expect(
      routeLengthMeters([
        [snapped.longitude, snapped.latitude],
        [moved.longitude, moved.latitude],
      ]),
    ).toBeCloseTo(2, 3);
  });

  it('selects the requested branch at a walkway intersection', () => {
    const center: [number, number] = [106.64, 10.76];
    const walkways: [number, number][][] = [
      [[106.6399, 10.76], center, [106.6401, 10.76]],
      [[106.64, 10.7599], center, [106.64, 10.7601]],
    ];
    const moved = movePointOnWalkways(
      { longitude: center[0], latitude: center[1] },
      'north',
      2,
      walkways,
    );

    expect(moved.longitude).toBeCloseTo(center[0], 8);
    expect(moved.latitude).toBeGreaterThan(center[1]);
  });

  it('parses displayed walkway GeoJSON and fails safely without paths', () => {
    const parsed = walkwayLinesFromGeoJson({
      type: 'FeatureCollection',
      features: [
        {
          geometry: {
            type: 'LineString',
            coordinates: [
              [106.64, 10.76],
              [106.6401, 10.76],
            ],
          },
        },
      ],
    });
    const point = { latitude: 10.76, longitude: 106.64 };

    expect(parsed).toHaveLength(1);
    expect(walkwayLinesFromGeoJson({ features: [{}] })).toEqual([]);
    expect(movePointOnWalkways(point, 'north', 2, [])).toEqual(point);
  });

  it('interpolates a short walking step along the route', () => {
    const progress = routeProgressAt(route, 2)!;
    expect(progress.traveledMeters).toBe(2);
    expect(progress.position.longitude).toBeGreaterThan(106.64);
    expect(progress.position.longitude).toBeLessThan(106.6401);
    expect(progress.position.latitude).toBeCloseTo(10.76, 7);
    expect(progress.complete).toBe(false);
  });

  it('clamps movement at the destination and reports completion', () => {
    const total = routeLengthMeters(route);
    const progress = routeProgressAt(route, total + 3)!;
    expect(progress.position).toEqual({
      longitude: 106.6401,
      latitude: 10.7601,
    });
    expect(progress.traveledMeters).toBeCloseTo(total, 6);
    expect(progress.remainingMeters).toBe(0);
    expect(progress.complete).toBe(true);
  });

  it('handles empty and zero-length routes safely', () => {
    expect(routeProgressAt([], 1)).toBeNull();
    expect(
      routeProgressAt(
        [
          [106.64, 10.76],
          [106.64, 10.76],
        ],
        1,
      )?.complete,
    ).toBe(true);
  });

  it('derives route distance from elapsed time and clamps at five seconds', () => {
    expect(simulationDistanceAtTime(80, -100)).toBe(0);
    expect(simulationDistanceAtTime(80, 2_500)).toBe(40);
    expect(simulationDistanceAtTime(80, 5_000)).toBe(80);
    expect(simulationDistanceAtTime(80, 9_000)).toBe(80);
  });
});

describe('simulated walk pace', () => {
  it('takes the route length at a calm pace, within 15 s and 100 s', () => {
    expect(simulationDurationMs(80)).toBe(15_000); // short leg: not a blink
    expect(simulationDurationMs(400)).toBe(50_000);
    expect(simulationDurationMs(750)).toBeCloseTo(93_750, 0);
    expect(simulationDurationMs(5000)).toBe(100_000); // very long: capped
  });
});
