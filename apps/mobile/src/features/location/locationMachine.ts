export type PermissionPrecision =
  | 'unknown'
  | 'denied'
  | 'approximate'
  | 'precise';
export type SignalQuality =
  | 'idle'
  | 'acquiring'
  | 'unavailable'
  | 'weak'
  | 'ready';

export interface LocationSample {
  latitude: number;
  longitude: number;
  accuracyMeters: number;
  timestamp: number;
}

export interface LocationState {
  permission: PermissionPrecision;
  signal: SignalQuality;
  sample: LocationSample | null;
  error: string | null;
}

export type LocationEvent =
  | { type: 'REQUEST_PERMISSION' }
  | {
      type: 'PERMISSION_RESULT';
      precision: Exclude<PermissionPrecision, 'unknown'>;
    }
  | { type: 'SAMPLE'; sample: LocationSample }
  | { type: 'POSITION_ERROR'; message: string }
  | { type: 'STOP' };

export const WEAK_ACCURACY_METERS = 50;

export const initialLocationState: LocationState = {
  permission: 'unknown',
  signal: 'idle',
  sample: null,
  error: null,
};

export function reduceLocation(
  state: LocationState,
  event: LocationEvent,
): LocationState {
  switch (event.type) {
    case 'REQUEST_PERMISSION':
      return { ...state, signal: 'acquiring', error: null };
    case 'PERMISSION_RESULT':
      return {
        ...state,
        permission: event.precision,
        signal: event.precision === 'denied' ? 'unavailable' : 'acquiring',
        error: event.precision === 'denied' ? 'permission-denied' : null,
      };
    case 'SAMPLE':
      if (state.permission === 'denied') return state;
      return {
        ...state,
        sample: event.sample,
        signal:
          event.sample.accuracyMeters > WEAK_ACCURACY_METERS ? 'weak' : 'ready',
        error: null,
      };
    case 'POSITION_ERROR':
      return { ...state, signal: 'unavailable', error: event.message };
    case 'STOP':
      return { ...state, signal: 'idle' };
  }
}
