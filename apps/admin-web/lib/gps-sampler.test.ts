import { describe, expect, it } from 'vitest';
import {
  MIN_DURATION_MS,
  MIN_SAMPLES,
  gpsQuality,
  isMeasurementReady,
  summarizeSamples,
  usableSamples,
  type GpsSample,
} from './gps-sampler';

const fix = (
  latitude: number,
  longitude: number,
  accuracyMeters: number,
  timestamp = 0,
): GpsSample => ({ latitude, longitude, accuracyMeters, timestamp });

describe('gps sampler', () => {
  it('averages with accuracy weights: the sharper fix pulls harder', () => {
    const summary = summarizeSamples([fix(10, 106, 5), fix(10.0001, 106, 10)])!;
    // weights 1/25 and 1/100 → 0.8 / 0.2 of the way
    expect(summary.latitude).toBeCloseTo(10.00002, 6);
    expect(summary.sampleCount).toBe(2);
  });

  it('never claims better accuracy than the best single fix', () => {
    const summary = summarizeSamples([fix(10, 106, 6), fix(10, 106, 7)])!;
    expect(summary.accuracyMeters).toBeGreaterThanOrEqual(6);
  });

  it('widens the accuracy when the samples wander', () => {
    // ~22 m apart although each fix claims 5 m
    const summary = summarizeSamples([fix(10, 106, 5), fix(10.0002, 106, 5)])!;
    expect(summary.spreadMeters).toBeGreaterThan(8);
    expect(summary.accuracyMeters).toBe(summary.spreadMeters);
  });

  it('ignores a stale/jumpy fix that disagrees with the rest', () => {
    const steady = Array.from({ length: 6 }, (_, i) => fix(10.0003, 106, 8, i));
    const summary = summarizeSamples([fix(10, 106, 8), ...steady])!; // 33 m away outlier
    expect(summary.sampleCount).toBe(6);
    expect(summary.latitude).toBeCloseTo(10.0003, 6);
  });

  it('keeps everything when the samples are spread evenly (no outlier to blame)', () => {
    const spread = [10, 10.00005, 10.0001, 10.00015].map((lat) =>
      fix(lat, 106, 12),
    );
    expect(summarizeSamples(spread)!.sampleCount).toBe(4);
  });

  it('drops poor and invalid fixes', () => {
    const samples = [
      fix(10, 106, 40),
      fix(NaN, 106, 5),
      fix(10, 106, 0),
      fix(10, 106, 9),
    ];
    expect(usableSamples(samples)).toHaveLength(1);
    expect(summarizeSamples([fix(10, 106, 40)])).toBeNull();
  });

  it('is ready only with enough good fixes AND enough time', () => {
    const samples = Array.from({ length: MIN_SAMPLES }, () => fix(10, 106, 8));
    expect(isMeasurementReady(samples, 0, MIN_DURATION_MS - 1)).toBe(false);
    expect(isMeasurementReady(samples.slice(1), 0, MIN_DURATION_MS)).toBe(
      false,
    );
    expect(isMeasurementReady(samples, 0, MIN_DURATION_MS)).toBe(true);
  });

  it('grades accuracy for the UI', () => {
    expect(gpsQuality(5)).toBe('good');
    expect(gpsQuality(12)).toBe('ok');
    expect(gpsQuality(30)).toBe('poor');
  });
});
