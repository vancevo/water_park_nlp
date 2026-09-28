import { describe, expect, it } from 'vitest';
import {
  routeLengthMeters,
  routeProgressAt,
  simulationDistanceAtTime,
} from './route-simulation';

const route: [number, number][] = [
  [106.64, 10.76],
  [106.6401, 10.76],
  [106.6401, 10.7601],
];

describe('route simulation', () => {
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
