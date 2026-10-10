import { normalizeSearchText, significantTerms } from './search-text.js';

/**
 * Cardinal-direction intent in a search query (C06 / T40 follow-up).
 *
 * "westernmost POI", "các điểm xa nhất về phía đông", "hàng phía bắc" ask WHERE
 * a place is, not what its text says, so lexical matching alone cannot answer
 * them. This module recognises one cardinal direction (N/S/E/W), strips the
 * direction wording from the query and keeps the rest as a residual text
 * filter. The search service then ranks by position along that axis.
 *
 * Deliberately conservative:
 * - Vietnamese direction words are only recognised after a marker ("phía",
 *   "hướng", "miền", "cực") because "nam", "bắc", "đông", "tây" are common
 *   words on their own (năm, bác, đông người, tay).
 * - Diagonals ("north-east", "phía đông bắc") are not interpreted (null), so
 *   they fall back to plain lexical search instead of a wrong axis.
 * - Pure, synchronous and side-effect free; nothing here logs the query.
 */

export type CardinalDirection = 'north' | 'south' | 'east' | 'west';

export interface DirectionIntent {
  direction: CardinalDirection;
  /** Query with the direction wording removed (may be empty). */
  residual: string;
}

const EN_DIRECTIONS: Readonly<Record<string, CardinalDirection>> = {
  north: 'north',
  northern: 'north',
  northernmost: 'north',
  northmost: 'north',
  south: 'south',
  southern: 'south',
  southernmost: 'south',
  southmost: 'south',
  east: 'east',
  eastern: 'east',
  easternmost: 'east',
  eastmost: 'east',
  west: 'west',
  western: 'west',
  westernmost: 'west',
  westmost: 'west',
};

const VI_DIRECTIONS: Readonly<Record<string, CardinalDirection>> = {
  bac: 'north',
  nam: 'south',
  dong: 'east',
  tay: 'west',
};

/** Words that introduce a Vietnamese direction ("phía đông", "hướng tây"). */
const VI_MARKERS = new Set(['phia', 'huong', 'mien', 'cuc']);

/** Superlative/locative filler around a direction; dropped from the residual. */
const DIRECTION_FILLER = new Set([
  // Vietnamese: "xa nhất về phía …", "ở phía …"
  'xa',
  'nhat',
  've',
  'o',
  'ben',
  // English: "the farthest … side/part/end of the park"
  'most',
  'far',
  'farthest',
  'furthest',
  'side',
  'part',
  'end',
  'edge',
  // Generic place nouns: "khu vực/điểm phía tây", "the eastern area/spot".
  'khu',
  'vuc',
  'diem',
  'dia',
  'place',
  'places',
  'spot',
  'spots',
  'area',
  'areas',
  'location',
  'locations',
  'attraction',
  'attractions',
]);

export function parseDirectionIntent(query: string): DirectionIntent | null {
  const tokens = normalizeSearchText(query).split(' ').filter(Boolean);
  let found: { direction: CardinalDirection; consumed: Set<number> } | null =
    null;
  for (let i = 0; i < tokens.length; i += 1) {
    const token = tokens[i]!;
    let direction: CardinalDirection | undefined;
    const consumed = new Set<number>([i]);
    if (EN_DIRECTIONS[token]) {
      direction = EN_DIRECTIONS[token];
    } else if (VI_MARKERS.has(token) && VI_DIRECTIONS[tokens[i + 1] ?? '']) {
      direction = VI_DIRECTIONS[tokens[i + 1]!];
      consumed.add(i + 1);
    }
    if (!direction) continue;
    if (found) return null; // Two directions: diagonal or contradictory.
    const next = tokens[Math.max(...consumed) + 1] ?? '';
    // "north east", "phía đông bắc": a diagonal, not one cardinal axis.
    if (EN_DIRECTIONS[next] || (consumed.size === 2 && VI_DIRECTIONS[next]))
      return null;
    found = { direction, consumed };
    i = Math.max(...consumed);
  }
  if (!found) return null;
  const residual = tokens
    .filter(
      (token, index) =>
        !found.consumed.has(index) && !DIRECTION_FILLER.has(token),
    )
    .join(' ');
  return { direction: found.direction, residual };
}

export interface Positioned {
  latitude: number;
  longitude: number;
}

/** Position along the requested direction: larger = farther that way. */
export function directionalCoordinate(
  point: Positioned,
  direction: CardinalDirection,
): number {
  switch (direction) {
    case 'north':
      return point.latitude;
    case 'south':
      return -point.latitude;
    case 'east':
      return point.longitude;
    case 'west':
      return -point.longitude;
  }
}

/**
 * ~5.5 m in degrees: points closer than this to the extreme are treated as
 * level with it, so tiny survey noise does not split one row of POIs.
 */
const MIN_BAND_DEGREES = 0.00005;
/** Share of the catalogue's extent along the axis counted as "that side". */
const BAND_SHARE = 0.15;

/**
 * The places at the requested edge of the given set: within
 * max(15 % of the set's extent along the axis, ~5 m) of the extreme one.
 * Returned farthest-first; ties keep the input order (stable sort).
 */
export function selectDirectionalBand<T>(
  items: readonly T[],
  direction: CardinalDirection,
  position: (item: T) => Positioned,
): T[] {
  if (items.length === 0) return [];
  const values = items.map((item) =>
    directionalCoordinate(position(item), direction),
  );
  const max = Math.max(...values);
  const min = Math.min(...values);
  const tolerance = Math.max((max - min) * BAND_SHARE, MIN_BAND_DEGREES);
  return items
    .map((item, index) => ({ item, value: values[index]! }))
    .filter(({ value }) => value >= max - tolerance)
    .sort((a, b) => b.value - a.value)
    .map(({ item }) => item);
}

/** Orders items farthest-first along the direction (stable). */
export function sortByDirection<T>(
  items: readonly T[],
  direction: CardinalDirection,
  position: (item: T) => Positioned,
): T[] {
  return [...items]
    .map((item) => ({
      item,
      value: directionalCoordinate(position(item), direction),
    }))
    .sort((a, b) => b.value - a.value)
    .map(({ item }) => item);
}

/**
 * The residual's significant words (stopwords dropped) to match as text, or
 * an empty string when nothing worth matching is left.
 */
export function residualText(residual: string): string {
  return significantTerms(residual).join(' ');
}
