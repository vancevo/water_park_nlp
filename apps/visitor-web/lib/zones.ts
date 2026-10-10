import type { GeoPoint } from '@damsen/shared-types';
import { geoDistanceMeters } from './route-simulation';

/**
 * Zones of the park: groups of neighbouring places (the clusters of the official map) that
 * get one spoken introduction when the visitor comes near them: what is there, what to try
 * and what to watch out for. Source: public/data/zones.json (editorial text, VI + EN; places
 * are listed by slug, their positions come from the places themselves).
 */
export interface ZoneText {
  vi: string;
  en: string;
}

export interface Zone {
  id: string;
  /** Slugs of the places that make up the zone. */
  members: string[];
  name: ZoneText;
  intro: ZoneText;
  try: ZoneText;
  tip: ZoneText;
}

export const ZONES_URL = '/data/zones.json';

export const ZONE_DEFAULTS = {
  /** Near a zone: within this distance of one of its places. */
  enterMeters: 60,
  /** …and still in it until further than this (hysteresis against GPS jitter). */
  exitMeters: 90,
  /** Another zone only takes over when this much closer than the current one. */
  switchMarginMeters: 20,
} as const;

let cache: Promise<Zone[]> | null = null;

/** Loads the zones once; resolves [] when the file is missing so the app still works. */
export function loadZones(
  fetchImplementation: typeof fetch = fetch,
): Promise<Zone[]> {
  cache ??= fetchImplementation(ZONES_URL)
    .then(async (response) =>
      response.ok ? ((await response.json()) as { zones: Zone[] }).zones : [],
    )
    .catch(() => []);
  return cache;
}

/** Text in the asked language; anything but English reads the Vietnamese text. */
export function zoneText(text: ZoneText, locale: string): string {
  return locale === 'en' && text.en ? text.en : text.vi;
}

/** Distance (metres) from the visitor to the nearest known place of every zone. */
export function zoneDistances(
  point: GeoPoint,
  zones: readonly Zone[],
  locations: ReadonlyMap<string, GeoPoint>,
): Record<string, number> {
  const distances: Record<string, number> = {};
  for (const zone of zones) {
    let nearest = Infinity;
    for (const slug of zone.members) {
      const place = locations.get(slug);
      if (place) nearest = Math.min(nearest, geoDistanceMeters(point, place));
    }
    if (nearest !== Infinity) distances[zone.id] = nearest;
  }
  return distances;
}

/**
 * The zone the visitor is in: the nearest one within the enter distance, kept until the
 * visitor is further than the exit distance, and handed over to another zone only when that
 * one is clearly closer. Null when the visitor is not near any zone.
 */
export function resolveZone(
  previousId: string | null,
  distances: Readonly<Record<string, number>>,
  options: Partial<typeof ZONE_DEFAULTS> = {},
): string | null {
  const { enterMeters, exitMeters, switchMarginMeters } = {
    ...ZONE_DEFAULTS,
    ...options,
  };
  let nearestId: string | null = null;
  for (const [id, distance] of Object.entries(distances)) {
    if (nearestId === null || distance < distances[nearestId]!) nearestId = id;
  }
  const nearest = nearestId === null ? Infinity : distances[nearestId]!;
  const previous = previousId === null ? undefined : distances[previousId];
  if (previousId !== null && previous !== undefined && previous <= exitMeters) {
    if (
      nearestId !== previousId &&
      nearest <= enterMeters &&
      nearest + switchMarginMeters < previous
    ) {
      return nearestId;
    }
    return previousId;
  }
  return nearestId !== null && nearest <= enterMeters ? nearestId : null;
}

/** The nearest zone and how far it is, whatever the enter distance (for the "where am I" box). */
export function nearestZone(
  distances: Readonly<Record<string, number>>,
): { id: string; distance: number } | null {
  let best: { id: string; distance: number } | null = null;
  for (const [id, distance] of Object.entries(distances)) {
    if (!best || distance < best.distance) best = { id, distance };
  }
  return best;
}

/** The line spoken first when the visitor comes near a zone (in the narration language). */
export function zoneArrivingLine(locale: string, name: string): string {
  return locale === 'en'
    ? `You are arriving at ${name}.`
    : `Bạn đang đến ${name}.`;
}

/** Spoken when auto narration is switched on: where the visitor is, and the question. */
export function zoneWelcomeLine(locale: string, name: string | null): string {
  if (locale === 'en') {
    return `${name ? `You are in ${name}.` : 'You are in Dam Sen park.'} Would you like to eat, find a restroom, rest, keep playing, or head home?`;
  }
  return `${name ? `Bạn đang ở ${name}.` : 'Bạn đang ở trong công viên Đầm Sen.'} Bạn muốn đi ăn, đi vệ sinh, nghỉ ngơi, chơi tiếp hay đi về?`;
}

/** What is spoken when the visitor comes to the zone: where, what is here, what to try, tips. */
export function zoneSpeech(
  zone: Zone,
  locale: string,
  arriving: string,
): string {
  return [
    arriving,
    zoneText(zone.intro, locale),
    zoneText(zone.try, locale),
    zoneText(zone.tip, locale),
  ].join(' ');
}

/** Key of a zone introduction in the listen history (a zone is heard once per language). */
export const zoneHistoryId = (zoneId: string) => `zone:${zoneId}`;
