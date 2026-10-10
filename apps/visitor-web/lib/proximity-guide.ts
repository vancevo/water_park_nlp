import type { GeoPoint } from '@damsen/shared-types';
import { geoDistanceMeters } from './route-simulation';

/**
 * Places that narrate on their own when the visitor walks up to them, by fixed
 * map number (see poi-number.ts): 25 Đu quay đứng, 26 Xe điện đụng thế hệ mới.
 */
export const AUTO_GUIDE_POI_NUMBERS: readonly number[] = [25, 26];

export const AUTO_GUIDE_DEFAULTS = {
  /** Start narrating inside this distance… */
  enterMeters: 25,
  /** …and only re-arm after leaving this one (hysteresis against GPS jitter). */
  exitMeters: 40,
  /** Fixes less accurate than this (metres) are shown but never trigger. */
  maxAccuracyMeters: 40,
  /** A place that just narrated stays quiet for this long after re-entry. */
  cooldownMs: 10 * 60_000,
} as const;

export interface GuideFix {
  point: GeoPoint;
  accuracyMeters: number;
}

export interface GuideTarget {
  id: string;
  location: GeoPoint;
}

export interface GuideState {
  inside: ReadonlySet<string>;
  lastTriggeredAt: ReadonlyMap<string, number>;
}

export const EMPTY_GUIDE_STATE: GuideState = {
  inside: new Set(),
  lastTriggeredAt: new Map(),
};

export interface GuideResult {
  state: GuideState;
  /** Measured distance (metres) from the visitor to every target. */
  distances: Record<string, number>;
  /** Target that just became "arrived" and should narrate (nearest only). */
  triggered: GuideTarget | null;
  /** Fix too inaccurate to trigger or release anything. */
  inaccurate: boolean;
}

/**
 * Pure geofence step: measures the visitor→place distance (haversine) and
 * decides whether a place was just reached. Raw positions never leave the
 * device; only the resulting narration request goes to the API.
 */
export function evaluateAutoGuide(
  state: GuideState,
  fix: GuideFix,
  targets: readonly GuideTarget[],
  nowMs: number,
  options: Partial<typeof AUTO_GUIDE_DEFAULTS> = {},
): GuideResult {
  const { enterMeters, exitMeters, maxAccuracyMeters, cooldownMs } = {
    ...AUTO_GUIDE_DEFAULTS,
    ...options,
  };
  const distances: Record<string, number> = {};
  for (const target of targets) {
    distances[target.id] = geoDistanceMeters(fix.point, target.location);
  }
  if (fix.accuracyMeters > maxAccuracyMeters) {
    return { state, distances, triggered: null, inaccurate: true };
  }

  const inside = new Set(state.inside);
  const lastTriggeredAt = new Map(state.lastTriggeredAt);
  let triggered: GuideTarget | null = null;
  for (const target of targets) {
    const distance = distances[target.id]!;
    if (inside.has(target.id)) {
      if (distance > exitMeters) inside.delete(target.id);
      continue;
    }
    if (distance > enterMeters) continue;
    inside.add(target.id);
    const last = lastTriggeredAt.get(target.id);
    if (last !== undefined && nowMs - last < cooldownMs) continue;
    if (!triggered || distance < distances[triggered.id]!) {
      triggered = target;
    }
  }
  if (triggered) lastTriggeredAt.set(triggered.id, nowMs);
  return {
    state: { inside, lastTriggeredAt },
    distances,
    triggered,
    inaccurate: false,
  };
}
