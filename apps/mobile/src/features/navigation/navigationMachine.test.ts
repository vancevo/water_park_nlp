import { describe, expect, it } from 'vitest';

import type { LocationSample } from '../location/locationMachine';
import type { NavigationRoute } from './model';
import {
  canReroute,
  initialNavigationState,
  reduceNavigation,
  REROUTE_COOLDOWN_MS,
} from './navigationMachine';

const route: NavigationRoute = {
  routeId: 'route-1',
  version: 1,
  geometry: {
    type: 'LineString',
    coordinates: [
      [106.635, 10.768],
      [106.636, 10.768],
    ],
  },
  distanceMeters: 110,
  etaSeconds: 90,
  steps: [
    { sequence: 1, instruction: 'Đi thẳng', distanceMeters: 70 },
    {
      sequence: 2,
      instruction: 'Điểm đến ở phía trước',
      distanceMeters: 40,
    },
  ],
};

function sample(
  longitude: number,
  latitude = 10.768,
  accuracyMeters = 5,
  timestamp = 1,
): LocationSample {
  return { longitude, latitude, accuracyMeters, timestamp };
}

function activeState() {
  const loading = reduceNavigation(initialNavigationState, {
    type: 'START',
    poiId: 'poi-1',
    accessible: false,
  });
  return reduceNavigation(loading, { type: 'ROUTE_SUCCEEDED', route });
}

describe('navigation GPS simulation', () => {
  it('tracks normal movement and advances route progress', () => {
    const started = activeState();
    const first = reduceNavigation(started, {
      type: 'GPS_SAMPLE',
      sample: sample(106.6352),
    });
    const second = reduceNavigation(first, {
      type: 'GPS_SAMPLE',
      sample: sample(106.6357, 10.768, 5, 2),
    });

    expect(first.status).toBe('navigating');
    expect(second.status).toBe('navigating');
    expect(second.match?.progress).toBeGreaterThan(first.match?.progress ?? 1);
    expect(second.match?.remainingMeters).toBeLessThan(50);
  });

  it('requires three good off-route samples and applies reroute cooldown', () => {
    let state = activeState();
    state = reduceNavigation(state, {
      type: 'GPS_SAMPLE',
      sample: sample(106.6355, 10.769, 5, 1),
    });
    state = reduceNavigation(state, {
      type: 'GPS_SAMPLE',
      sample: sample(106.6355, 10.769, 5, 2),
    });
    expect(state.status).toBe('navigating');

    state = reduceNavigation(state, {
      type: 'GPS_SAMPLE',
      sample: sample(106.6355, 10.769, 5, 3),
    });
    expect(state.status).toBe('offRoute');
    expect(canReroute(state, 20_000)).toBe(true);

    state = reduceNavigation(state, { type: 'REROUTE_STARTED', at: 20_000 });
    state = { ...state, status: 'offRoute' };
    expect(canReroute(state, 20_000 + REROUTE_COOLDOWN_MS - 1)).toBe(false);
    expect(canReroute(state, 20_000 + REROUTE_COOLDOWN_MS)).toBe(true);
  });

  it('suppresses weak or lost GPS without creating false off-route progress', () => {
    const started = activeState();
    const weak = reduceNavigation(started, {
      type: 'GPS_SAMPLE',
      sample: sample(106.6355, 10.77, 80),
    });
    const lost = reduceNavigation(weak, { type: 'GPS_LOST' });

    expect(weak.status).toBe('navigating');
    expect(weak.match).toBeNull();
    expect(weak.consecutiveOffRouteSamples).toBe(0);
    expect(lost.status).toBe('navigating');
    expect(lost.gpsSuppressed).toBe(true);
  });

  it('marks arrival at the route destination', () => {
    const arrived = reduceNavigation(activeState(), {
      type: 'GPS_SAMPLE',
      sample: sample(106.636),
    });

    expect(arrived.status).toBe('arrived');
    expect(arrived.match?.remainingMeters).toBe(0);
  });
});
