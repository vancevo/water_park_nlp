import { describe, expect, it } from 'vitest';
import {
  EMPTY_GUIDE_STATE,
  evaluateAutoGuide,
  isAutoNarrationEligible,
  AUTO_TRIGGER_ALSO_NEAR,
  guideDistanceMeters,
  markGuideFired,
  type GuideFix,
  type GuideState,
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
  atMs: number,
  accuracyMeters = 8,
): GuideFix => ({
  point: {
    latitude: target.location.latitude + metres / 111_320,
    longitude: target.location.longitude,
  },
  accuracyMeters,
  atMs,
});

function step(
  state: GuideState,
  fix: GuideFix,
  targets: GuideTarget[],
  now = fix.atMs,
  preferId: string | null = null,
) {
  return evaluateAutoGuide(state, fix, targets, now, { preferId });
}

describe('auto guide geofence', () => {
  it('measures the haversine distance to each place', () => {
    const result = step(EMPTY_GUIDE_STATE, north(wheel, 100, 0), [
      wheel,
      bumper,
    ]);
    expect(result.distances.wheel).toBeCloseTo(100, 0);
    expect(result.distances.bumper).toBeCloseTo(
      geoDistanceMeters(north(wheel, 100, 0).point, bumper.location),
      6,
    );
  });

  it('needs a 2 s stay inside the radius before a place is a candidate', () => {
    let result = step(EMPTY_GUIDE_STATE, north(wheel, 45, 0), [wheel]);
    expect(result.candidates).toEqual([]); // just entered
    result = step(result.state, north(wheel, 40, 1500), [wheel]);
    expect(result.candidates).toEqual([]);
    result = step(result.state, north(wheel, 40, 2000), [wheel]);
    expect(result.candidates.map((c) => c.id)).toEqual(['wheel']);
  });

  it('is not a candidate when only passing through faster than the stay', () => {
    let result = step(EMPTY_GUIDE_STATE, north(wheel, 45, 0), [wheel]);
    result = step(result.state, north(wheel, 80, 1000), [wheel]); // left the exit radius
    result = step(result.state, north(wheel, 85, 3000), [wheel]);
    expect(result.candidates).toEqual([]);
  });

  it('stays quiet once handled, until the visitor leaves and comes back', () => {
    let result = step(EMPTY_GUIDE_STATE, north(wheel, 30, 0), [wheel]);
    result = step(result.state, north(wheel, 30, 2500), [wheel]);
    expect(result.candidates).toHaveLength(1);
    const state = markGuideFired(result.state, 'wheel');
    result = step(state, north(wheel, 20, 4000), [wheel]);
    expect(result.candidates).toEqual([]);
    // leaves (> exit radius), then re-enters after the re-arm delay
    result = step(result.state, north(wheel, 90, 5000), [wheel]);
    result = step(result.state, north(wheel, 30, 11_000), [wheel]);
    result = step(result.state, north(wheel, 30, 13_500), [wheel]);
    expect(result.candidates.map((c) => c.id)).toEqual(['wheel']);
  });

  it('ignores GPS jitter at the edge: 5 s outside before an entry counts again', () => {
    let result = step(EMPTY_GUIDE_STATE, north(wheel, 40, 0), [wheel]);
    result = step(result.state, north(wheel, 40, 2500), [wheel]);
    const state = markGuideFired(result.state, 'wheel');
    result = step(state, north(wheel, 75, 3000), [wheel]); // out
    result = step(result.state, north(wheel, 40, 4000), [wheel]); // back after 1 s
    result = step(result.state, north(wheel, 40, 7000), [wheel]);
    expect(result.candidates).toEqual([]);
  });

  it('does not trigger on a fix that is too inaccurate or too old', () => {
    const inaccurate = step(EMPTY_GUIDE_STATE, north(wheel, 20, 0, 60), [
      wheel,
    ]);
    expect(inaccurate.inaccurate).toBe(true);
    expect(inaccurate.state).toBe(EMPTY_GUIDE_STATE);
    const stale = step(EMPTY_GUIDE_STATE, north(wheel, 20, 0), [wheel], 20_000);
    expect(stale.stale).toBe(true);
    expect(stale.candidates).toEqual([]);
  });

  it('orders several candidates: route destination, then nearest, then id', () => {
    const a: GuideTarget = { id: 'a', location: wheel.location };
    const b: GuideTarget = {
      id: 'b',
      location: {
        ...wheel.location,
        latitude: wheel.location.latitude + 0.0001,
      },
    };
    const run = (preferId: string | null) => {
      let r = step(EMPTY_GUIDE_STATE, north(a, 5, 0), [a, b], 0, preferId);
      r = step(r.state, north(a, 5, 2500), [a, b], 2500, preferId);
      return r.candidates.map((c) => c.id);
    };
    expect(run(null)).toEqual(['a', 'b']);
    expect(run('b')).toEqual(['b', 'a']);
  });
});

describe('which places narrate by themselves', () => {
  it('leaves out only the toilets and the test spot, keeps the rest', () => {
    expect(isAutoNarrationEligible('p25-du-quay-dung')).toBe(true);
    expect(isAutoNarrationEligible('new-cafe-windy')).toBe(true);
    // every place with a story narrates, services included; only toilets stay quiet
    expect(isAutoNarrationEligible('svc-food-1')).toBe(true);
    expect(isAutoNarrationEligible('svc-parking-1')).toBe(true);
    expect(isAutoNarrationEligible('svc-first-aid')).toBe(true);
    expect(isAutoNarrationEligible('svc-security')).toBe(true);
    expect(isAutoNarrationEligible('svc-wc-3')).toBe(false);
    expect(isAutoNarrationEligible('svc-wc-access-2')).toBe(false);
    expect(isAutoNarrationEligible('new-diem-thu')).toBe(false);
  });
});

describe('places that also start near another spot', () => {
  const wheel = { latitude: 10.7644143, longitude: 106.6368945 };
  const toilet = { latitude: 10.7646954, longitude: 106.6374128 }; // ~65 m from the wheel

  it('measures to the nearest of the place and its extra spots', () => {
    expect(geoDistanceMeters(toilet, wheel)).toBeGreaterThan(60);
    expect(guideDistanceMeters(toilet, { location: wheel })).toBeGreaterThan(
      60,
    );
    expect(
      guideDistanceMeters(toilet, { location: wheel, alsoNear: [toilet] }),
    ).toBe(0);
  });

  it('the Ferris wheel is narrated beside the accessible toilet 2', () => {
    expect(AUTO_TRIGGER_ALSO_NEAR['p25-du-quay-dung']).toContain(
      'svc-wc-access-2',
    );
    const targets = [{ id: 'wheel', location: wheel, alsoNear: [toilet] }];
    const at = (atMs: number) => ({ point: toilet, accuracyMeters: 8, atMs });
    const arm = evaluateAutoGuide(EMPTY_GUIDE_STATE, at(0), targets, 0);
    const first = evaluateAutoGuide(arm.state, at(2500), targets, 2500);
    expect(first.candidates.map((c) => c.id)).toEqual(['wheel']);
    // Without the extra spot the toilet is too far from the wheel.
    const plain = [{ id: 'wheel', location: wheel }];
    const none = evaluateAutoGuide(
      evaluateAutoGuide(EMPTY_GUIDE_STATE, at(0), plain, 0).state,
      at(2500),
      plain,
      2500,
    );
    expect(none.candidates).toEqual([]);
  });
});
