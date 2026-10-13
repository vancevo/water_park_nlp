import type { GeoPoint } from '@damsen/shared-types';
import { describe, expect, it } from 'vitest';

import {
  PRESENCE_PUBLISH_INTERVAL_MS,
  presencePublishDelay,
} from './presence-publish';

const gate: GeoPoint = { latitude: 10.7658059, longitude: 106.6416272 };

describe('presence publish throttle', () => {
  it('publishes the first fix immediately', () => {
    expect(presencePublishDelay(null, gate, 1_000)).toBe(0);
  });

  it('keeps a moved point for a trailing publish at the rate boundary', () => {
    const moved = { ...gate, latitude: gate.latitude + 0.000045 };
    expect(
      presencePublishDelay({ position: gate, at: 1_000 }, moved, 1_250),
    ).toBe(PRESENCE_PUBLISH_INTERVAL_MS - 250);
    expect(
      presencePublishDelay({ position: gate, at: 1_000 }, moved, 2_000),
    ).toBe(0);
  });

  it('suppresses tiny jitter but lets a heartbeat refresh the TTL', () => {
    const jitter = { ...gate, latitude: gate.latitude + 0.000001 };
    const last = { position: gate, at: 1_000 };
    expect(presencePublishDelay(last, jitter, 3_000)).toBeNull();
    expect(presencePublishDelay(last, jitter, 3_000, true)).toBe(0);
  });
});
