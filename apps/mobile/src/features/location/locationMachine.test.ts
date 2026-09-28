import { describe, expect, it } from 'vitest';

import { initialLocationState, reduceLocation } from './locationMachine';

describe('reduceLocation', () => {
  it('represents a denied permission without retaining a location', () => {
    const requested = reduceLocation(initialLocationState, {
      type: 'REQUEST_PERMISSION',
    });
    const denied = reduceLocation(requested, {
      type: 'PERMISSION_RESULT',
      precision: 'denied',
    });

    expect(denied).toMatchObject({
      permission: 'denied',
      signal: 'unavailable',
      sample: null,
      error: 'permission-denied',
    });
  });

  it('keeps approximate permission separate from signal accuracy', () => {
    const allowed = reduceLocation(initialLocationState, {
      type: 'PERMISSION_RESULT',
      precision: 'approximate',
    });
    const located = reduceLocation(allowed, {
      type: 'SAMPLE',
      sample: {
        latitude: 10.7682,
        longitude: 106.6358,
        accuracyMeters: 18,
        timestamp: 1,
      },
    });

    expect(located.permission).toBe('approximate');
    expect(located.signal).toBe('ready');
  });

  it('marks a sample over 50 metres as weak', () => {
    const allowed = reduceLocation(initialLocationState, {
      type: 'PERMISSION_RESULT',
      precision: 'precise',
    });
    const located = reduceLocation(allowed, {
      type: 'SAMPLE',
      sample: {
        latitude: 10.7682,
        longitude: 106.6358,
        accuracyMeters: 51,
        timestamp: 1,
      },
    });

    expect(located.signal).toBe('weak');
  });

  it('ignores location samples after permission is denied', () => {
    const denied = reduceLocation(initialLocationState, {
      type: 'PERMISSION_RESULT',
      precision: 'denied',
    });

    expect(
      reduceLocation(denied, {
        type: 'SAMPLE',
        sample: { latitude: 1, longitude: 1, accuracyMeters: 1, timestamp: 1 },
      }),
    ).toBe(denied);
  });
});
