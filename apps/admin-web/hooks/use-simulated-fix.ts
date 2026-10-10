'use client';
import { useEffect, useState } from 'react';
import { simulatedFix } from '@/lib/field-simulation';
import type { LiveFix } from './use-watch-position';

/** A pretend GPS fix near `center` every second; null (and idle) while `center` is null. */
export function useSimulatedFix(
  center: { latitude: number; longitude: number } | null,
): LiveFix | null {
  const [fix, setFix] = useState<LiveFix | null>(null);
  const latitude = center?.latitude;
  const longitude = center?.longitude;

  useEffect(() => {
    if (latitude === undefined || longitude === undefined) {
      setFix(null);
      return;
    }
    const tick = () =>
      setFix(simulatedFix({ latitude, longitude }, Date.now()));
    tick();
    const timer = window.setInterval(tick, 1000);
    return () => window.clearInterval(timer);
  }, [latitude, longitude]);

  return fix;
}
