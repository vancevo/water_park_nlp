import type { GeoPoint } from '@damsen/shared-types';
import { amenityKind } from './amenities';
import { geoDistanceMeters } from './route-simulation';

/** What the visitor may want next, asked in the "where do you want to go" box. */
export type NextStopKind = 'eat' | 'toilet' | 'rest' | 'play' | 'home';

export const NEXT_STOP_KINDS: readonly NextStopKind[] = [
  'eat',
  'toilet',
  'rest',
  'play',
  'home',
];

interface StopCandidate {
  slug: string;
  category: string;
  location: GeoPoint;
}

/** Coffee places are slugged `...ca-phe...` / `...cafe...`. */
const isCafe = (slug: string) => /(^|-)(ca-phe|cafe)(-|$)/.test(slug);

const PLAY_CATEGORIES = new Set(['ride', 'thrill_ride', 'children']);

/** A place "here" is not a suggestion to go somewhere: skip what the visitor stands at. */
const ALREADY_THERE_METERS = 25;

const matches: Record<NextStopKind, (poi: StopCandidate) => boolean> = {
  eat: (poi) => poi.category === 'food' && !isCafe(poi.slug),
  toilet: (poi) => {
    const kind = amenityKind(poi.slug);
    return kind === 'wc' || kind === 'wc-access';
  },
  rest: (poi) => poi.category === 'food' && isCafe(poi.slug),
  play: (poi) => PLAY_CATEGORIES.has(poi.category),
  home: (poi) => poi.category === 'gate',
};

/**
 * The nearest place for what the visitor wants: food that is not a café (to eat), toilets,
 * cafés (to rest; any food place when there is no café), rides and children's attractions
 * (to play on, not the one they stand at) and gates (to go home).
 */
export function pickNextStop<T extends StopCandidate>(
  kind: NextStopKind,
  from: GeoPoint,
  pois: readonly T[],
): { poi: T; distance: number } | null {
  const search = (test: (poi: StopCandidate) => boolean) => {
    let best: { poi: T; distance: number } | null = null;
    for (const poi of pois) {
      if (!test(poi)) continue;
      const distance = geoDistanceMeters(from, poi.location);
      if (kind === 'play' && distance < ALREADY_THERE_METERS) continue;
      if (!best || distance < best.distance) best = { poi, distance };
    }
    return best;
  };
  return (
    search(matches[kind]) ??
    (kind === 'rest' ? search((poi) => poi.category === 'food') : null)
  );
}
