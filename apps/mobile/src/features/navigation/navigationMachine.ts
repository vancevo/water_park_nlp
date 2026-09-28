import type { LocationSample } from '../location/locationMachine';
import { matchRoute, type RouteMatch } from './geo';
import type { NavigationRoute } from './model';

export type NavigationStatus =
  | 'idle'
  | 'loading'
  | 'navigating'
  | 'offRoute'
  | 'arrived'
  | 'error';

export interface NavigationState {
  status: NavigationStatus;
  poiId: string | null;
  accessible: boolean;
  route: NavigationRoute | null;
  match: RouteMatch | null;
  lastSample: LocationSample | null;
  consecutiveOffRouteSamples: number;
  gpsSuppressed: boolean;
  lastRerouteAt: number | null;
  error: string | null;
}

export type NavigationEvent =
  | { type: 'START'; poiId: string; accessible: boolean }
  | { type: 'ROUTE_SUCCEEDED'; route: NavigationRoute }
  | { type: 'ROUTE_FAILED'; message: string }
  | { type: 'GPS_SAMPLE'; sample: LocationSample }
  | { type: 'GPS_LOST' }
  | { type: 'REROUTE_STARTED'; at: number }
  | { type: 'STOP' };

export const OFF_ROUTE_DISTANCE_METERS = 25;
export const OFF_ROUTE_REQUIRED_SAMPLES = 3;
export const ARRIVAL_DISTANCE_METERS = 15;
export const NAVIGATION_MAX_ACCURACY_METERS = 50;
export const REROUTE_COOLDOWN_MS = 15_000;

export const initialNavigationState: NavigationState = {
  status: 'idle',
  poiId: null,
  accessible: false,
  route: null,
  match: null,
  lastSample: null,
  consecutiveOffRouteSamples: 0,
  gpsSuppressed: false,
  lastRerouteAt: null,
  error: null,
};

export function canReroute(state: NavigationState, now: number): boolean {
  return (
    state.status === 'offRoute' &&
    state.poiId !== null &&
    state.lastSample !== null &&
    (state.lastRerouteAt === null ||
      now - state.lastRerouteAt >= REROUTE_COOLDOWN_MS)
  );
}

export function reduceNavigation(
  state: NavigationState,
  event: NavigationEvent,
): NavigationState {
  switch (event.type) {
    case 'START':
      return {
        ...initialNavigationState,
        status: 'loading',
        poiId: event.poiId,
        accessible: event.accessible,
      };
    case 'ROUTE_SUCCEEDED':
      return {
        ...state,
        status: 'navigating',
        route: event.route,
        match: null,
        consecutiveOffRouteSamples: 0,
        gpsSuppressed: false,
        error: null,
      };
    case 'ROUTE_FAILED':
      return { ...state, status: 'error', error: event.message };
    case 'GPS_SAMPLE': {
      if (
        !state.route ||
        (state.status !== 'navigating' && state.status !== 'offRoute')
      ) {
        return state;
      }
      if (event.sample.accuracyMeters > NAVIGATION_MAX_ACCURACY_METERS) {
        return { ...state, lastSample: event.sample, gpsSuppressed: true };
      }
      const match = matchRoute(state.route, event.sample);
      if (match.remainingMeters <= ARRIVAL_DISTANCE_METERS) {
        return {
          ...state,
          status: 'arrived',
          match,
          lastSample: event.sample,
          consecutiveOffRouteSamples: 0,
          gpsSuppressed: false,
        };
      }
      const outside = match.distanceFromRouteMeters > OFF_ROUTE_DISTANCE_METERS;
      const consecutiveOffRouteSamples = outside
        ? state.consecutiveOffRouteSamples + 1
        : 0;
      return {
        ...state,
        status:
          consecutiveOffRouteSamples >= OFF_ROUTE_REQUIRED_SAMPLES
            ? 'offRoute'
            : 'navigating',
        match,
        lastSample: event.sample,
        consecutiveOffRouteSamples,
        gpsSuppressed: false,
      };
    }
    case 'GPS_LOST':
      return state.status === 'navigating' || state.status === 'offRoute'
        ? { ...state, gpsSuppressed: true }
        : state;
    case 'REROUTE_STARTED':
      return state.status === 'offRoute'
        ? {
            ...state,
            status: 'loading',
            lastRerouteAt: event.at,
            consecutiveOffRouteSamples: 0,
          }
        : state;
    case 'STOP':
      return initialNavigationState;
  }
}
