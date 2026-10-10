import { describe, expect, it } from 'vitest';
import {
  EMPTY_GUIDE_STATE,
  evaluateAutoGuide,
  type GuideFix,
  type GuideTarget,
} from './proximity-guide';
import { geoDistanceMeters } from './route-simulation';

const wheel: GuideTarget = {
  id: 'wheel',
  location: { latitude: 10.7642469, longitude: 106.636908 },
};
const bumper: GuideTarget = {
  id: 'bumper',
  location: { latitude: 10.7634211, longitude: 106.6380587 },
};
// ~1.11e-5 degrees of latitude per metre
const north = (
  target: GuideTarget,
  metres: number,
  accuracyMeters = 8,
): GuideFix => ({
  point: {
    latitude: target.location.latitude + metres / 111_320,
    longitude: target.location.longitude,
  },
  accuracyMeters,
});

describe('auto guide geofence', () => {
  it('measures the haversine distance to each place', () => {
    const result = evaluateAutoGuide(
      EMPTY_GUIDE_STATE,
      north(wheel, 100),
      [wheel, bumper],
      0,
    );
    expect(result.distances.wheel).toBeCloseTo(100, 0);
    expect(result.distances.bumper).toBeCloseTo(
      geoDistanceMeters(north(wheel, 100).point, bumper.location),
      6,
    );
  });

  it('triggers once on entering the radius, not while far away', () => {
    let state = EMPTY_GUIDE_STATE;
    const far = evaluateAutoGuide(state, north(wheel, 60), [wheel], 0);
    expect(far.triggered).toBeNull();
    state = far.state;
    const near = evaluateAutoGuide(state, north(wheel, 20), [wheel], 1000);
    expect(near.triggered?.id).toBe('wheel');
    const still = evaluateAutoGuide(
      near.state,
      north(wheel, 10),
      [wheel],
      2000,
    );
    expect(still.triggered).toBeNull();
  });

  it('needs to leave the exit radius, then respects the cooldown', () => {
    const entered = evaluateAutoGuide(
      EMPTY_GUIDE_STATE,
      north(wheel, 5),
      [wheel],
      0,
    );
    // jitter between enter (25) and exit (40) keeps the place "inside"
    const jitter = evaluateAutoGuide(
      entered.state,
      north(wheel, 33),
      [wheel],
      1000,
    );
    const back = evaluateAutoGuide(
      jitter.state,
      north(wheel, 10),
      [wheel],
      2000,
    );
    expect(back.triggered).toBeNull();
    // leave, come back within the cooldown → quiet
    const left = evaluateAutoGuide(back.state, north(wheel, 80), [wheel], 3000);
    const again = evaluateAutoGuide(
      left.state,
      north(wheel, 10),
      [wheel],
      4000,
    );
    expect(again.triggered).toBeNull();
    // after the cooldown it narrates again
    const left2 = evaluateAutoGuide(
      again.state,
      north(wheel, 80),
      [wheel],
      5000,
    );
    const later = evaluateAutoGuide(
      left2.state,
      north(wheel, 10),
      [wheel],
      11 * 60_000,
    );
    expect(later.triggered?.id).toBe('wheel');
  });

  it('ignores inaccurate fixes but still reports the distance', () => {
    const result = evaluateAutoGuide(
      EMPTY_GUIDE_STATE,
      north(wheel, 5, 120),
      [wheel],
      0,
    );
    expect(result.inaccurate).toBe(true);
    expect(result.triggered).toBeNull();
    expect(result.distances.wheel).toBeCloseTo(5, 0);
  });

  it('narrates only the nearest when two places are reached at once', () => {
    const a: GuideTarget = { id: 'a', location: wheel.location };
    const b: GuideTarget = {
      id: 'b',
      location: {
        latitude: wheel.location.latitude + 10 / 111_320,
        longitude: wheel.location.longitude,
      },
    };
    const result = evaluateAutoGuide(EMPTY_GUIDE_STATE, north(a, 2), [b, a], 0);
    expect(result.triggered?.id).toBe('a');
  });
});
