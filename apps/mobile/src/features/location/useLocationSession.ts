import * as Location from 'expo-location';
import { useCallback, useEffect, useReducer, useRef } from 'react';

import {
  initialLocationState,
  reduceLocation,
  type PermissionPrecision,
} from './locationMachine';

const WATCH_OPTIONS: Location.LocationOptions = {
  accuracy: Location.Accuracy.Balanced,
  distanceInterval: 5,
  timeInterval: 5_000,
};

function permissionPrecision(
  permission: Location.LocationPermissionResponse,
): Exclude<PermissionPrecision, 'unknown'> {
  if (!permission.granted) return 'denied';

  if (permission.android?.accuracy === 'coarse') return 'approximate';

  // Expo SDK 52 exposes the iOS authorization scope but not Apple's
  // full/reduced accuracy flag. A granted iOS permission is therefore the
  // strongest permission level this adapter can report; signal accuracy is
  // still classified independently for every position sample.
  return 'precise';
}

export function useLocationSession() {
  const [state, dispatch] = useReducer(reduceLocation, initialLocationState);
  const subscription = useRef<Location.LocationSubscription | null>(null);

  const stop = useCallback(() => {
    subscription.current?.remove();
    subscription.current = null;
    dispatch({ type: 'STOP' });
  }, []);

  const start = useCallback(async () => {
    dispatch({ type: 'REQUEST_PERMISSION' });
    try {
      const permission = await Location.requestForegroundPermissionsAsync();
      const precision = permissionPrecision(permission);
      dispatch({ type: 'PERMISSION_RESULT', precision });
      if (precision === 'denied') return;

      subscription.current?.remove();
      subscription.current = await Location.watchPositionAsync(
        WATCH_OPTIONS,
        (position) => {
          const accuracy = position.coords.accuracy;
          dispatch({
            type: 'SAMPLE',
            sample: {
              latitude: position.coords.latitude,
              longitude: position.coords.longitude,
              accuracyMeters:
                accuracy == null || accuracy < 0 ? 1_000 : accuracy,
              timestamp: position.timestamp,
            },
          });
        },
      );
    } catch (error) {
      dispatch({
        type: 'POSITION_ERROR',
        message:
          error instanceof Error ? error.message : 'location-unavailable',
      });
    }
  }, []);

  useEffect(() => stop, [stop]);

  return { state, start, stop };
}
