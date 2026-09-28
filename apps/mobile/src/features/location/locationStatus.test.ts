import { describe, expect, it } from 'vitest';

import type { LocationState } from './locationMachine';
import { getLocationNotice } from './locationStatus';

const sample = {
  latitude: 10.7682,
  longitude: 106.6358,
  accuracyMeters: 72.4,
  timestamp: 1,
};

describe('getLocationNotice', () => {
  it('does not let approximate permission mask a weak GPS fix', () => {
    const state: LocationState = {
      permission: 'approximate',
      signal: 'weak',
      sample,
      error: null,
    };

    expect(getLocationNotice(state)).toEqual({ key: 'weakGps', meters: 72 });
  });

  it('reports unavailable independently of precise permission', () => {
    const state: LocationState = {
      permission: 'precise',
      signal: 'unavailable',
      sample: null,
      error: 'provider-disabled',
    };

    expect(getLocationNotice(state)).toEqual({ key: 'unavailableGps' });
  });

  it('reports precise only when a usable fix is ready', () => {
    const state: LocationState = {
      permission: 'precise',
      signal: 'ready',
      sample: { ...sample, accuracyMeters: 12 },
      error: null,
    };

    expect(getLocationNotice(state)).toEqual({ key: 'preciseGps' });
  });
});
