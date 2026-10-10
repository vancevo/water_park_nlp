import type { GeoPoint } from '@damsen/shared-types';
import { amenityKind } from './amenities';
import { geoDistanceMeters } from './route-simulation';

/**
 * Geofence for the automatic narration. Pure: it measures the distance from the visitor
 * to every place and says which place the visitor has *stayed near* long enough. What to
 * do about it (play, queue, skip as heard) is the audio side's job.
 *
 * A place becomes a candidate once, per visit to its zone: the visitor must be inside the
 * enter radius for `dwellMs` with fixes that are accurate and fresh. After a candidate was
 * handled (`markFired`) the place only arms again after the visitor left the exit radius
 * for `rearmMs` and came back, so GPS jitter at the edge cannot retrigger it.
 */
export const AUTO_GUIDE_DEFAULTS = {
  /** Candidate inside this distance (calibrated on site: 50 m)… */
  enterMeters: 50,
  /** …and only re-arm after leaving this one (hysteresis against GPS jitter). */
  exitMeters: 70,
  /** Fixes less accurate than this (metres) are shown but never trigger. */
  maxAccuracyMeters: 40,
  /** Stay this long inside the radius before the place is a candidate. */
  dwellMs: 2000,
  /** A fix older than this is stale and ignored. */
  maxFixAgeMs: 10_000,
  /** After leaving the exit radius, wait this long before an entry counts again. */
  rearmMs: 5000,
} as const;

export interface GuideFix {
  point: GeoPoint;
  accuracyMeters: number;
  /** When the position was measured (ms since epoch). */
  atMs: number;
}

export interface GuideTarget {
  id: string;
  location: GeoPoint;
  /** More spots that count as "near this place" (see AUTO_TRIGGER_ALSO_NEAR). */
  alsoNear?: readonly GeoPoint[];
}

export interface GuideState {
  /** Places whose zone the visitor is in, since when, and whether it was handled. */
  inside: ReadonlyMap<string, { sinceMs: number; fired: boolean }>;
  /** When the visitor left each zone (for the re-arm delay). */
  leftAtMs: ReadonlyMap<string, number>;
}

export const EMPTY_GUIDE_STATE: GuideState = {
  inside: new Map(),
  leftAtMs: new Map(),
};

export interface GuideResult {
  state: GuideState;
  /** Measured distance (metres) from the visitor to every target. */
  distances: Record<string, number>;
  /**
   * Places the visitor has stayed near long enough and that were not handled yet:
   * the route destination first, then the nearest, then by id.
   */
  candidates: GuideTarget[];
  /** Fix too inaccurate or too old to trigger or release anything. */
  inaccurate: boolean;
  stale: boolean;
}

/** Distance to a target: to the place itself or to the nearest extra spot that counts as near it. */
export function guideDistanceMeters(
  point: GeoPoint,
  target: Pick<GuideTarget, 'location' | 'alsoNear'>,
): number {
  let nearest = geoDistanceMeters(point, target.location);
  for (const spot of target.alsoNear ?? []) {
    nearest = Math.min(nearest, geoDistanceMeters(point, spot));
  }
  return nearest;
}

export function evaluateAutoGuide(
  state: GuideState,
  fix: GuideFix,
  targets: readonly GuideTarget[],
  nowMs: number,
  options: Partial<typeof AUTO_GUIDE_DEFAULTS> & {
    /** The place the visitor is being guided to, if it is inside its zone. */
    preferId?: string | null;
  } = {},
): GuideResult {
  const {
    enterMeters,
    exitMeters,
    maxAccuracyMeters,
    dwellMs,
    maxFixAgeMs,
    rearmMs,
  } = {
    ...AUTO_GUIDE_DEFAULTS,
    ...options,
  };
  const distances: Record<string, number> = {};
  for (const target of targets) {
    distances[target.id] = guideDistanceMeters(fix.point, target);
  }
  const stale = nowMs - fix.atMs > maxFixAgeMs;
  const inaccurate = fix.accuracyMeters > maxAccuracyMeters;
  if (stale || inaccurate) {
    return { state, distances, candidates: [], inaccurate, stale };
  }

  const inside = new Map(state.inside);
  const leftAtMs = new Map(state.leftAtMs);
  const candidates: GuideTarget[] = [];
  for (const target of targets) {
    const distance = distances[target.id]!;
    const here = inside.get(target.id);
    if (here) {
      if (distance > exitMeters) {
        inside.delete(target.id);
        leftAtMs.set(target.id, nowMs);
        continue;
      }
      if (!here.fired && nowMs - here.sinceMs >= dwellMs) {
        candidates.push(target);
      }
      continue;
    }
    if (distance > enterMeters) continue;
    const left = leftAtMs.get(target.id);
    if (left !== undefined && nowMs - left < rearmMs) continue;
    inside.set(target.id, { sinceMs: nowMs, fired: false });
    if (dwellMs <= 0) candidates.push(target);
  }
  candidates.sort((a, b) => {
    if (options.preferId) {
      if (a.id === options.preferId) return -1;
      if (b.id === options.preferId) return 1;
    }
    return distances[a.id]! - distances[b.id]! || a.id.localeCompare(b.id);
  });
  return {
    state: { inside, leftAtMs },
    distances,
    candidates,
    inaccurate,
    stale,
  };
}

/** The place was handled (played, queued or skipped as heard): not a candidate again until re-armed. */
export function markGuideFired(state: GuideState, id: string): GuideState {
  const here = state.inside.get(id);
  if (!here || here.fired) return state;
  const inside = new Map(state.inside);
  inside.set(id, { ...here, fired: true });
  return { inside, leftAtMs: state.leftAtMs };
}

/**
 * Places that may narrate by themselves: every place with a story, services (food, parking,
 * first aid, security) included. Only the toilets and the test spot stay quiet: a visitor passes
 * toilets all day, and listening to them is still one tap away.
 */
const NOT_AUTO_SLUGS: ReadonlySet<string> = new Set(['new-diem-thu']);

export function isAutoNarrationEligible(slug: string): boolean {
  const kind = amenityKind(slug);
  return kind !== 'wc' && kind !== 'wc-access' && !NOT_AUTO_SLUGS.has(slug);
}

/**
 * Places whose pin sits away from the walkway although the real thing stands right at the road:
 * walking past the listed spot (slug) also starts the narration of the place (slug). The pin and
 * the route entrance stay where they are. Ferris wheel: it is seen from the accessible toilet 2.
 */
export const AUTO_TRIGGER_ALSO_NEAR: Readonly<
  Record<string, readonly string[]>
> = { 'p25-du-quay-dung': ['svc-wc-access-2'] };
