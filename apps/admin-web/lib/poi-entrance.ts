import type { PoiDraft } from './poi-contract';
import { nearestWalkNode, type WalkNode } from './walk-nodes';

const same = (
  a: { latitude: number; longitude: number },
  b: { latitude: number; longitude: number },
) => a.latitude === b.latitude && a.longitude === b.longitude;

/**
 * The editor no longer manages entrances: a place always has a primary entrance on the path graph.
 * When the place has none, or its position changed since it was loaded, the primary entrance is
 * (re)attached to the nearest walkway node; otherwise the stored entrance is kept as it is (it may
 * have been measured on site). Other entrances are left alone. Without nodes the draft is unchanged.
 */
export function withPrimaryEntrance(
  draft: PoiDraft,
  loadedLocation: PoiDraft['location'],
  nodes: WalkNode[],
): PoiDraft {
  const primary = draft.entrances.find((item) => item.isPrimary);
  const moved = !same(draft.location, loadedLocation);
  const hasNode = Boolean(primary?.graphNodeRef);
  if (primary && hasNode && !moved) return draft;
  const nearest = nearestWalkNode(nodes, draft.location);
  if (!nearest) return draft;
  const snapped = {
    labelVi: primary?.labelVi || 'Lối vào',
    labelEn: primary?.labelEn || 'Entrance',
    accessibility: primary?.accessibility ?? 'standard',
    ...(primary?.id ? { id: primary.id } : {}),
    location: {
      latitude: nearest.node.lat,
      longitude: nearest.node.lon,
    },
    graphNodeRef: nearest.node.ref,
    isPrimary: true,
  };
  return {
    ...draft,
    entrances: [
      snapped,
      ...draft.entrances.filter((item) => item !== primary),
    ].map((item, index) => ({ ...item, isPrimary: index === 0 })),
  };
}
