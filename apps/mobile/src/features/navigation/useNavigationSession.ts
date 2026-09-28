import { AppState } from 'react-native';
import { useCallback, useEffect, useReducer, useRef } from 'react';

import type { LocationState } from '../location/locationMachine';
import type { RouteClient } from './model';
import {
  canReroute,
  initialNavigationState,
  reduceNavigation,
} from './navigationMachine';

export function useNavigationSession(
  client: RouteClient,
  location: LocationState,
) {
  const [state, dispatch] = useReducer(
    reduceNavigation,
    initialNavigationState,
  );
  const abortController = useRef<AbortController | null>(null);
  const requestInFlight = useRef(false);

  const requestRoute = useCallback(
    async (poiId: string, accessible: boolean, reroute: boolean) => {
      const sample = location.sample;
      if (!sample || location.signal !== 'ready' || requestInFlight.current) {
        if (!reroute) {
          dispatch({ type: 'ROUTE_FAILED', message: 'gps-not-ready' });
        }
        return;
      }

      requestInFlight.current = true;
      abortController.current?.abort();
      const controller = new AbortController();
      abortController.current = controller;
      if (reroute) dispatch({ type: 'REROUTE_STARTED', at: Date.now() });
      else dispatch({ type: 'START', poiId, accessible });

      try {
        const route = await client.createRoute({
          from: { lat: sample.latitude, lng: sample.longitude },
          poiId,
          accessible,
          signal: controller.signal,
        });
        dispatch({ type: 'ROUTE_SUCCEEDED', route });
      } catch (error) {
        if (!controller.signal.aborted) {
          dispatch({
            type: 'ROUTE_FAILED',
            message: error instanceof Error ? error.message : 'route-failed',
          });
        }
      } finally {
        requestInFlight.current = false;
      }
    },
    [client, location.sample, location.signal],
  );

  useEffect(() => {
    const sample = location.sample;
    if (location.signal === 'unavailable') dispatch({ type: 'GPS_LOST' });
    else if (sample) dispatch({ type: 'GPS_SAMPLE', sample });
  }, [location.sample, location.signal]);

  useEffect(() => {
    if (!canReroute(state, Date.now()) || !state.poiId) return;
    void requestRoute(state.poiId, state.accessible, true);
  }, [requestRoute, state]);

  useEffect(() => {
    const subscription = AppState.addEventListener('change', (nextState) => {
      if (nextState !== 'active') {
        dispatch({ type: 'GPS_LOST' });
      } else if (location.signal === 'unavailable') {
        dispatch({ type: 'GPS_LOST' });
      } else if (location.sample) {
        dispatch({ type: 'GPS_SAMPLE', sample: location.sample });
      }
    });
    return () => subscription.remove();
  }, [location.sample, location.signal]);

  useEffect(
    () => () => {
      abortController.current?.abort();
    },
    [],
  );

  return {
    state,
    start: (poiId: string, accessible = false) =>
      requestRoute(poiId, accessible, false),
    stop: () => dispatch({ type: 'STOP' }),
  };
}
