/**
 * Place types an editor can choose. Slugs must exist in `poi_categories`
 * (seed 002 + migration 013); the visitor app translates them.
 */
export const POI_CATEGORIES: readonly { slug: string; label: string }[] = [
  { slug: 'gate', label: 'Cổng' },
  { slug: 'ride', label: 'Trò chơi' },
  { slug: 'thrill_ride', label: 'Trò chơi cảm giác mạnh' },
  { slug: 'children', label: 'Khu thiếu nhi' },
  { slug: 'interactive', label: 'Tương tác' },
  { slug: 'show', label: 'Sân khấu / Biểu diễn' },
  { slug: 'exhibit', label: 'Trưng bày' },
  { slug: 'garden', label: 'Vườn cảnh' },
  { slug: 'indoor', label: 'Trong nhà' },
  { slug: 'landmark', label: 'Điểm hẹn / Biểu tượng' },
  { slug: 'food', label: 'Ăn uống' },
  { slug: 'restroom', label: 'Nhà vệ sinh' },
  { slug: 'parking', label: 'Bãi đậu xe' },
  { slug: 'first_aid', label: 'Y tế' },
];

/** Options for a select; keeps an unknown current slug selectable instead of dropping it. */
export function categoryOptions(
  current: string,
): { slug: string; label: string }[] {
  const known = POI_CATEGORIES.some((item) => item.slug === current);
  return current && !known
    ? [{ slug: current, label: `${current} (loại cũ)` }, ...POI_CATEGORIES]
    : [...POI_CATEGORIES];
}

/** Vietnamese label for a category slug (the slug itself when unknown). */
export function categoryLabel(slug: string): string {
  return POI_CATEGORIES.find((item) => item.slug === slug)?.label ?? slug;
}
