import { poiNumber } from './poi-number';
import type { PoiPinColor } from './poi-pin-colors';
import type { UiLocale } from './ui-text';

/**
 * Attractions inside a big place (e.g. the children's area, number 11) from the legend of the
 * official park map. A child with a `pin` also has its own small pin on the map.
 * Source: data/pois/sub-places.json, built into public/data/sub-places.json by
 * data/walkways-new/build_graph.py.
 */
export interface SubPlace {
  nameVi: string;
  nameEn: string;
  /** Label on the map, like "11.1". Absent for children without a pin of their own. */
  pin?: string;
  color?: PoiPinColor;
  latitude?: number;
  longitude?: number;
}

export type SubPlaces = Record<string, SubPlace[]>;

export const SUB_PLACES_URL = '/data/sub-places.json';

let cache: Promise<SubPlaces> | null = null;

/** Loads the sub-places once; resolves {} when the file is missing so the app still works. */
export function loadSubPlaces(
  fetchImplementation: typeof fetch = fetch,
): Promise<SubPlaces> {
  cache ??= fetchImplementation(SUB_PLACES_URL)
    .then(async (response) =>
      response.ok
        ? ((await response.json()) as { places: SubPlaces }).places
        : {},
    )
    .catch(() => ({}));
  return cache;
}

/** The children of a place, found through the `pNN-` number of its slug. */
export function subPlacesFor(places: SubPlaces, slug: string): SubPlace[] {
  const number = poiNumber(slug);
  return number === null ? [] : (places[String(number)] ?? []);
}

export function subPlaceName(child: SubPlace, locale: UiLocale): string {
  return locale === 'en' ? child.nameEn : child.nameVi;
}
