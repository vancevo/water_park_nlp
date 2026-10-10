'use client';
import { useEffect, useState } from 'react';
import {
  GEOLOCATION_MESSAGES,
  failureForCode,
  type GeolocationFailure,
} from '@/lib/geolocate';

export interface LiveFix {
  latitude: number;
  longitude: number;
  accuracyMeters: number;
  timestamp: number;
}

/**
 * Follows the device position (high accuracy) while mounted. `error` is a Vietnamese,
 * user-facing message (HTTPS needed / permission denied / no signal), or ''.
 */
export function useWatchPosition(enabled = true): {
  fix: LiveFix | null;
  error: string;
} {
  const [fix, setFix] = useState<LiveFix | null>(null);
  const [error, setError] = useState('');

  useEffect(() => {
    if (!enabled) return;
    const fail = (reason: GeolocationFailure) =>
      setError(GEOLOCATION_MESSAGES[reason]);
    if (!window.isSecureContext) return fail('insecure');
    if (!navigator.geolocation) return fail('unsupported');
    const id = navigator.geolocation.watchPosition(
      (position) => {
        setError('');
        setFix({
          latitude: position.coords.latitude,
          longitude: position.coords.longitude,
          accuracyMeters: position.coords.accuracy,
          timestamp: position.timestamp,
        });
      },
      (failure) => fail(failureForCode(failure.code)),
      { enableHighAccuracy: true, maximumAge: 0, timeout: 30_000 },
    );
    return () => navigator.geolocation.clearWatch(id);
  }, [enabled]);

  return { fix, error };
}
