import { distanceMeters } from './walk-nodes';

/** One GPS fix while standing still. */
export interface GpsSample {
  latitude: number;
  longitude: number;
  accuracyMeters: number;
  timestamp: number;
}

export interface GpsSummary {
  latitude: number;
  longitude: number;
  /**
   * Honest accuracy of the averaged point, metres: never better than the best single
   * fix (GPS errors are correlated, so averaging does not shrink them like noise) and
   * never smaller than how far the samples wandered.
   */
  accuracyMeters: number;
  sampleCount: number;
  /** Weighted RMS distance of the samples from the average. */
  spreadMeters: number;
}

/** Fixes worse than this are ignored while measuring (the API refuses > 50 m anyway). */
export const SAMPLE_MAX_ACCURACY_METERS = 25;
/** A measurement needs at least this many good fixes AND this much time. */
export const MIN_SAMPLES = 6;
export const MIN_DURATION_MS = 6_000;

export type GpsQuality = 'good' | 'ok' | 'poor';

export function gpsQuality(accuracyMeters: number): GpsQuality {
  return accuracyMeters <= 8 ? 'good' : accuracyMeters <= 15 ? 'ok' : 'poor';
}

/** Keeps usable fixes only. */
export function usableSamples(
  samples: readonly GpsSample[],
  maxAccuracy = SAMPLE_MAX_ACCURACY_METERS,
): GpsSample[] {
  return samples.filter(
    (sample) =>
      Number.isFinite(sample.latitude) &&
      Number.isFinite(sample.longitude) &&
      sample.accuracyMeters > 0 &&
      sample.accuracyMeters <= maxAccuracy,
  );
}

/** Whether enough good fixes were collected over enough time. */
export function isMeasurementReady(
  samples: readonly GpsSample[],
  startedAt: number,
  now: number,
): boolean {
  return (
    usableSamples(samples).length >= MIN_SAMPLES &&
    now - startedAt >= MIN_DURATION_MS
  );
}

const median = (values: number[]): number => {
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2
    ? sorted[mid]!
    : (sorted[mid - 1]! + sorted[mid]!) / 2;
};

/**
 * Drops fixes that jumped away from where most of the samples agree (a stale fix from
 * before you arrived, a multipath spike). Needs ≥ 4 samples to judge.
 */
export function withoutOutliers(good: readonly GpsSample[]): GpsSample[] {
  if (good.length < 4) return [...good];
  const centre = {
    latitude: median(good.map((s) => s.latitude)),
    longitude: median(good.map((s) => s.longitude)),
  };
  const limit = Math.max(10, 2 * median(good.map((s) => s.accuracyMeters)));
  const kept = good.filter((s) => distanceMeters(s, centre) <= limit);
  return kept.length >= Math.ceil(good.length / 2) ? kept : [...good];
}

/** Accuracy-weighted average of the usable samples (weight 1/accuracy²), or null. */
export function summarizeSamples(
  samples: readonly GpsSample[],
): GpsSummary | null {
  const good = withoutOutliers(usableSamples(samples));
  if (good.length === 0) return null;
  let weightSum = 0;
  let latitude = 0;
  let longitude = 0;
  for (const sample of good) {
    const weight = 1 / sample.accuracyMeters ** 2;
    weightSum += weight;
    latitude += sample.latitude * weight;
    longitude += sample.longitude * weight;
  }
  latitude /= weightSum;
  longitude /= weightSum;
  let squared = 0;
  for (const sample of good) {
    const weight = 1 / sample.accuracyMeters ** 2;
    squared += weight * distanceMeters(sample, { latitude, longitude }) ** 2;
  }
  const spreadMeters = Math.sqrt(squared / weightSum);
  const best = Math.min(...good.map((sample) => sample.accuracyMeters));
  return {
    latitude: Number(latitude.toFixed(7)),
    longitude: Number(longitude.toFixed(7)),
    accuracyMeters: Number(Math.max(best, spreadMeters).toFixed(1)),
    sampleCount: good.length,
    spreadMeters: Number(spreadMeters.toFixed(1)),
  };
}
