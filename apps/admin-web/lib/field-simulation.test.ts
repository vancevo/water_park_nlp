import { describe, expect, it } from 'vitest';
import { distanceMeters } from './walk-nodes';
import { FIELD_SIMULATION_SLUG, simulatedFix } from './field-simulation';

const place = { latitude: 10.76642, longitude: 106.63674 };

describe('simulated field fix', () => {
  it('stays a few metres from the place with a good accuracy', () => {
    for (let t = 0; t < 60_000; t += 1000) {
      const fix = simulatedFix(place, 1_700_000_000_000 + t);
      const away = distanceMeters(fix, place);
      expect(away).toBeGreaterThan(3.5);
      expect(away).toBeLessThan(8);
      expect(fix.accuracyMeters).toBeGreaterThanOrEqual(4.5);
      expect(fix.accuracyMeters).toBeLessThanOrEqual(6);
      expect(fix.timestamp).toBe(1_700_000_000_000 + t);
    }
  });

  it('is deterministic for a given time and wobbles over time', () => {
    const a = simulatedFix(place, 5000);
    expect(simulatedFix(place, 5000)).toEqual(a);
    expect(simulatedFix(place, 6000)).not.toEqual(a);
  });

  it('targets the experimental place only', () => {
    expect(FIELD_SIMULATION_SLUG).toBe('new-diem-thu');
  });
});
