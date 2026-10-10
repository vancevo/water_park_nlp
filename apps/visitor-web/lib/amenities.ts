/**
 * Service points of the park map: food, toilets, parking, first aid, security. They are ordinary
 * places whose slug is `svc-<kind>[-N]` (data/pois/amenities.json) and whose map marker is the
 * icon of the official map (public/icons/svc-<kind>.png) instead of a numbered pin.
 */
export type AmenityKind =
  | 'food'
  | 'wc'
  | 'wc-access'
  | 'parking'
  | 'first-aid'
  | 'security';

export const AMENITY_KINDS: readonly AmenityKind[] = [
  'food',
  'wc',
  'wc-access',
  'parking',
  'first-aid',
  'security',
];

const SLUG = /^svc-(food|wc-access|wc|parking|first-aid|security)(?:-\d+)?$/;

export function amenityKind(slug: string): AmenityKind | null {
  const match = SLUG.exec(slug);
  return match ? (match[1] as AmenityKind) : null;
}

export function amenityIconUrl(kind: AmenityKind): string {
  return `/icons/svc-${kind}.png`;
}
