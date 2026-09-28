import type { LocationState } from './locationMachine';

export type LocationNotice =
  | { key: 'deniedGps' }
  | { key: 'unavailableGps' }
  | { key: 'weakGps'; meters: number }
  | { key: 'acquiringGps' }
  | { key: 'approximateGps' }
  | { key: 'preciseGps' };

/**
 * Signal failures take precedence over permission precision. This prevents a
 * granted/approximate permission from masking that the current fix is unusable.
 */
export function getLocationNotice(state: LocationState): LocationNotice | null {
  if (state.permission === 'denied') return { key: 'deniedGps' };
  if (state.signal === 'unavailable') return { key: 'unavailableGps' };
  if (state.signal === 'weak' && state.sample) {
    return { key: 'weakGps', meters: Math.round(state.sample.accuracyMeters) };
  }
  if (state.signal === 'acquiring') return { key: 'acquiringGps' };
  if (state.permission === 'approximate') return { key: 'approximateGps' };
  if (state.permission === 'precise' && state.signal === 'ready') {
    return { key: 'preciseGps' };
  }
  return null;
}
