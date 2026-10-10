/**
 * Fixed number of a place on the numbered pin map (1–50). It is the `pNN-`
 * prefix of the slug (data/pois/damsen-pois.json), so it never depends on the
 * visitor's position, search or list order. Places added later without that
 * prefix have no number.
 */
export function poiNumber(slug: string): number | null {
  const match = /^p(\d{2})-/.exec(slug);
  return match ? Number(match[1]) : null;
}

export function formatPoiNumber(slug: string): string {
  const number = poiNumber(slug);
  return number === null ? '·' : String(number).padStart(2, '0');
}

/** Numbered places first in map order; unnumbered ones keep their order after. */
export function sortByPoiNumber<T extends { slug: string }>(items: T[]): T[] {
  return items
    .map((item, index) => ({ item, index, number: poiNumber(item.slug) }))
    .sort(
      (a, b) =>
        (a.number ?? Number.POSITIVE_INFINITY) -
          (b.number ?? Number.POSITIVE_INFINITY) || a.index - b.index,
    )
    .map(({ item }) => item);
}
