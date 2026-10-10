import { isNewPlace, poiNumber } from './poi-number';

/**
 * Colour of each numbered pin on the official park map legend: white = free to visit, blue =
 * suitable for everyone, purple = 1 m - 1.2 m, pink = 1 m - 1.4 m, red = over 1.4 m,
 * yellow = gate / ticket counter. Source: data/walkways-new/pins.json (read off the pin image).
 */
export type PoiPinColor =
  | 'white'
  | 'blue'
  | 'purple'
  | 'pink'
  | 'red'
  | 'yellow';

export const POI_PIN_COLORS: Readonly<Record<number, PoiPinColor>> = {
  1: 'yellow',
  2: 'yellow',
  3: 'yellow',
  4: 'red',
  5: 'blue',
  6: 'white',
  7: 'blue',
  8: 'white',
  9: 'blue',
  10: 'blue',
  11: 'pink',
  12: 'blue',
  13: 'pink',
  14: 'blue',
  15: 'blue',
  16: 'yellow',
  17: 'yellow',
  18: 'white',
  19: 'white',
  20: 'white',
  21: 'red',
  22: 'red',
  23: 'red',
  24: 'red',
  25: 'blue',
  26: 'blue',
  27: 'blue',
  28: 'white',
  29: 'white',
  30: 'white',
  31: 'blue',
  32: 'red',
  33: 'white',
  34: 'white',
  35: 'white',
  36: 'blue',
  37: 'white',
  38: 'white',
  39: 'white',
  40: 'white',
  41: 'white',
  42: 'white',
  43: 'white',
  44: 'white',
  45: 'blue',
  46: 'red',
  47: 'red',
  48: 'white',
  49: 'white',
  50: 'white',
};

/** Colour of the places added after the numbered map (data/pois/new-places.json). */
export const NEW_PLACE_COLORS: Readonly<Record<string, PoiPinColor>> = {
  'new-truot-phao-tren-tham': 'red',
  'new-cafe-windy': 'white',
  'new-diem-thu': 'blue',
  'new-dao-than-tai': 'white',
  'new-cong-lien-thong': 'yellow',
};

/** Pin colour of a place from its `pNN-` slug; places without a number keep the default pin. */
export function poiPinColor(slug: string): PoiPinColor | null {
  if (isNewPlace(slug)) return NEW_PLACE_COLORS[slug] ?? null;
  const number = poiNumber(slug);
  return number === null ? null : (POI_PIN_COLORS[number] ?? null);
}
