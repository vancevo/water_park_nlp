import type { GeoPoint } from '@damsen/shared-types';

import { geoDistanceMeters } from './route-simulation';

export const PRESENCE_PUBLISH_INTERVAL_MS = 1_000;
export const PRESENCE_MIN_MOVEMENT_METERS = 2;

export interface LastPresencePublish {
  position: GeoPoint;
  at: number;
}

export function presencePublishDelay(
  last: LastPresencePublish | null,
  next: GeoPoint,
  now: number,
  heartbeat = false,
): number | null {
  if (!last) return 0;
  if (
    !heartbeat &&
    geoDistanceMeters(last.position, next) < PRESENCE_MIN_MOVEMENT_METERS
  ) {
    return null;
  }
  return Math.max(0, PRESENCE_PUBLISH_INTERVAL_MS - (now - last.at));
}
