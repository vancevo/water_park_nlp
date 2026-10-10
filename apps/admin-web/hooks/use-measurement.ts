'use client';
import { useCallback, useEffect, useRef, useState } from 'react';
import {
  MIN_DURATION_MS,
  MIN_SAMPLES,
  isMeasurementReady,
  summarizeSamples,
  usableSamples,
  type GpsSample,
  type GpsSummary,
} from '@/lib/gps-sampler';
import type { LiveFix } from './use-watch-position';

export interface Measurement {
  phase: 'idle' | 'measuring' | 'done';
  summary: GpsSummary | null;
  goodSamples: number;
  needSamples: number;
  elapsedMs: number;
  needMs: number;
  start(): void;
  cancel(): void;
}

/** Stand still and collect GPS fixes; resolves an averaged position (see lib/gps-sampler). */
export function useMeasurement(fix: LiveFix | null): Measurement {
  const [phase, setPhase] = useState<Measurement['phase']>('idle');
  const [samples, setSamples] = useState<GpsSample[]>([]);
  const [summary, setSummary] = useState<GpsSummary | null>(null);
  const [startedAt, setStartedAt] = useState(0);
  const [now, setNow] = useState(() => Date.now());
  const lastTimestamp = useRef(0);

  useEffect(() => {
    if (
      phase !== 'measuring' ||
      !fix ||
      fix.timestamp === lastTimestamp.current
    )
      return;
    lastTimestamp.current = fix.timestamp;
    if (fix.timestamp < startedAt - 300) return; // taken before "measure" was pressed
    setSamples((before) => [...before, { ...fix }]);
  }, [fix, phase, startedAt]);

  useEffect(() => {
    if (phase !== 'measuring') return;
    const timer = window.setInterval(() => setNow(Date.now()), 500);
    return () => window.clearInterval(timer);
  }, [phase]);

  useEffect(() => {
    if (phase !== 'measuring' || !isMeasurementReady(samples, startedAt, now))
      return;
    setSummary(summarizeSamples(samples));
    setPhase('done');
  }, [phase, samples, startedAt, now]);

  const start = useCallback(() => {
    lastTimestamp.current = 0;
    setSamples([]);
    setSummary(null);
    setStartedAt(Date.now());
    setNow(Date.now());
    setPhase('measuring');
  }, []);
  const cancel = useCallback(() => {
    setPhase('idle');
    setSamples([]);
  }, []);

  return {
    phase,
    summary,
    goodSamples: usableSamples(samples).length,
    needSamples: MIN_SAMPLES,
    elapsedMs:
      phase === 'measuring' ? Math.min(MIN_DURATION_MS, now - startedAt) : 0,
    needMs: MIN_DURATION_MS,
    start,
    cancel,
  };
}
