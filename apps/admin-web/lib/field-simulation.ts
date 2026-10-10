import type { LiveFix } from '@/hooks/use-watch-position';

/**
 * The experimental place (slug) on which `/field` shows the measuring screen with a SIMULATED
 * GPS: a fix a few metres from the place, so the screen looks like standing there. It never
 * touches the real position: nothing is saved and nothing is sent.
 */
export const FIELD_SIMULATION_SLUG = 'new-diem-thu';

const METRES_PER_DEGREE_LAT = 110_574;
const METRES_PER_DEGREE_LON_AT_EQUATOR = 111_320;

/** Where the pretend phone stands relative to the place: ~5 m north, ~3 m east (never under 3 m, so the screen says how far it is). */
const OFFSET_NORTH_METRES = 5;
const OFFSET_EAST_METRES = 3;

/**
 * A believable live fix near `center`: it wobbles by under a metre and the reported accuracy
 * drifts between 4.5 and 6 m, as a phone in the open does. Deterministic in `atMs`.
 */
export function simulatedFix(
  center: { latitude: number; longitude: number },
  atMs: number,
): LiveFix {
  const north = OFFSET_NORTH_METRES + 0.8 * Math.sin(atMs / 700);
  const east = OFFSET_EAST_METRES + 0.8 * Math.cos(atMs / 900);
  const metresPerDegreeLon =
    METRES_PER_DEGREE_LON_AT_EQUATOR *
    Math.cos((center.latitude * Math.PI) / 180);
  return {
    latitude: Number(
      (center.latitude + north / METRES_PER_DEGREE_LAT).toFixed(7),
    ),
    longitude: Number(
      (center.longitude + east / metresPerDegreeLon).toFixed(7),
    ),
    accuracyMeters: Number((5.25 + 0.75 * Math.sin(atMs / 1300)).toFixed(1)),
    timestamp: atMs,
  };
}
