/**
 * Pin size and clustering for the map, as pure functions on screen coordinates.
 * The places keep their real coordinates: only what is *drawn* changes (a pin, or a
 * cluster standing for several pins whose touch areas would overlap).
 */

/** Pin body size (px): 20 at the whole-park zoom, +8 per zoom level, clamped 16–40. */
export const PIN_SIZE_AT_REFERENCE = 20;
export const PIN_SIZE_PER_ZOOM = 8;
export const PIN_SIZE_MIN = 16;
export const PIN_SIZE_MAX = 40;
/** Touch targets are at least this large on coarse pointers. */
export const MIN_TOUCH_PX = 44;
/** Two pins that were together stay together until they are this much apart (px). */
export const CLUSTER_HYSTERESIS_PX = 6;

export function pinSizeForZoom(zoom: number, referenceZoom: number): number {
  const size =
    PIN_SIZE_AT_REFERENCE + (zoom - referenceZoom) * PIN_SIZE_PER_ZOOM;
  return Math.min(PIN_SIZE_MAX, Math.max(PIN_SIZE_MIN, size));
}

export interface LayoutPoint {
  id: string;
  /** Centre of the touch area on screen (px). */
  cx: number;
  cy: number;
  /** The place being viewed / routed to / narrated: always drawn on its own. */
  priority?: boolean;
}

export interface LayoutOptions {
  /** Edge of one point's touch area (px): max(pin size, touch minimum on phones). */
  hitPx: number;
  /** Edge of a cluster badge's touch area (px). */
  clusterPx: number;
  viewport: { width: number; height: number };
  /** Points this far outside the viewport are not laid out (px). */
  padding?: number;
  /** id → group key from the previous layout, for a gentle in/out threshold. */
  previous?: ReadonlyMap<string, string>;
}

export interface Cluster {
  /** Stable while the membership is stable. */
  key: string;
  ids: string[];
  cx: number;
  cy: number;
  /** Set when the cluster sits beside a priority pin it would otherwise cover. */
  attachedTo: string | null;
}

export interface LayoutResult {
  singles: string[];
  clusters: Cluster[];
  /** Outside the viewport (not drawn, not counted). */
  offscreen: string[];
  /** Group key per drawn id: the id itself for a single, the cluster key otherwise. */
  groups: Map<string, string>;
}

function overlap(
  ax: number,
  ay: number,
  ah: number,
  bx: number,
  by: number,
  bh: number,
  margin = 0,
): boolean {
  const reach = (ah + bh) / 2 + margin;
  return Math.abs(ax - bx) < reach && Math.abs(ay - by) < reach;
}

class UnionFind {
  private readonly parent: number[];
  constructor(size: number) {
    this.parent = Array.from({ length: size }, (_, i) => i);
  }
  find(i: number): number {
    while (this.parent[i] !== i) {
      this.parent[i] = this.parent[this.parent[i]!]!;
      i = this.parent[i]!;
    }
    return i;
  }
  union(a: number, b: number): void {
    const ra = this.find(a);
    const rb = this.find(b);
    if (ra !== rb) this.parent[Math.max(ra, rb)] = Math.min(ra, rb);
  }
}

export function layoutMarkers(
  points: readonly LayoutPoint[],
  options: LayoutOptions,
): LayoutResult {
  const { hitPx, clusterPx, viewport } = options;
  const pad = options.padding ?? 60;
  const previous = options.previous;
  const visible: LayoutPoint[] = [];
  const offscreen: string[] = [];
  for (const point of points) {
    const inside =
      point.cx >= -pad &&
      point.cx <= viewport.width + pad &&
      point.cy >= -pad &&
      point.cy <= viewport.height + pad;
    if (inside) visible.push(point);
    else offscreen.push(point.id);
  }
  // A stable order: priority first, then by id (so grouping never depends on array order).
  visible.sort(
    (a, b) =>
      Number(Boolean(b.priority)) - Number(Boolean(a.priority)) ||
      a.id.localeCompare(b.id),
  );
  const prioritized = visible.filter((point) => point.priority);
  const normal = visible.filter((point) => !point.priority);

  const together = (a: LayoutPoint, b: LayoutPoint) =>
    previous?.get(a.id) !== undefined &&
    previous.get(a.id) === previous.get(b.id)
      ? CLUSTER_HYSTERESIS_PX
      : 0;

  // 1. Normal points that touch a priority pin are folded away next to it.
  const shadowed = new Map<string, LayoutPoint[]>();
  const free: LayoutPoint[] = [];
  for (const point of normal) {
    const owner = prioritized.find((p) =>
      overlap(point.cx, point.cy, hitPx, p.cx, p.cy, hitPx),
    );
    if (owner) {
      const list = shadowed.get(owner.id) ?? [];
      list.push(point);
      shadowed.set(owner.id, list);
    } else free.push(point);
  }

  // 2. Connected groups of overlapping touch areas among the free points.
  const sets = new UnionFind(free.length);
  for (let i = 0; i < free.length; i += 1) {
    for (let j = i + 1; j < free.length; j += 1) {
      const a = free[i]!;
      const b = free[j]!;
      if (overlap(a.cx, a.cy, hitPx, b.cx, b.cy, hitPx, together(a, b))) {
        sets.union(i, j);
      }
    }
  }
  let groups = new Map<number, LayoutPoint[]>();
  free.forEach((point, index) => {
    const root = sets.find(index);
    groups.set(root, [...(groups.get(root) ?? []), point]);
  });

  // 3. A cluster badge stands at the centre of its members: merge any group whose badge would
  // land on another group or on a priority pin, until nothing overlaps.
  const centre = (members: LayoutPoint[]) => ({
    cx: members.reduce((sum, p) => sum + p.cx, 0) / members.length,
    cy: members.reduce((sum, p) => sum + p.cy, 0) / members.length,
  });
  for (let pass = 0; pass < 6; pass += 1) {
    const list = [...groups.values()];
    const boxes = list.map((members) => ({
      members,
      ...centre(members),
      size: members.length > 1 ? clusterPx : hitPx,
    }));
    const merge = new UnionFind(boxes.length);
    let changed = false;
    for (let i = 0; i < boxes.length; i += 1) {
      for (let j = i + 1; j < boxes.length; j += 1) {
        const a = boxes[i]!;
        const b = boxes[j]!;
        if (
          (a.members.length > 1 || b.members.length > 1) &&
          overlap(a.cx, a.cy, a.size, b.cx, b.cy, b.size)
        ) {
          merge.union(i, j);
          changed = true;
        }
      }
    }
    if (!changed) break;
    const merged = new Map<number, LayoutPoint[]>();
    boxes.forEach((box, index) => {
      const root = merge.find(index);
      merged.set(root, [...(merged.get(root) ?? []), ...box.members]);
    });
    groups = merged;
  }

  const result: LayoutResult = {
    singles: prioritized.map((p) => p.id),
    clusters: [],
    offscreen,
    groups: new Map(),
  };
  for (const point of prioritized) result.groups.set(point.id, point.id);
  for (const members of groups.values()) {
    if (members.length === 1) {
      result.singles.push(members[0]!.id);
      result.groups.set(members[0]!.id, members[0]!.id);
      continue;
    }
    const ids = members.map((m) => m.id).sort();
    const key = `c:${ids[0]}:${ids.length}`;
    result.clusters.push({ key, ids, ...centre(members), attachedTo: null });
    for (const id of ids) result.groups.set(id, key);
  }
  for (const [ownerId, members] of shadowed) {
    const owner = prioritized.find((p) => p.id === ownerId)!;
    const ids = members.map((m) => m.id).sort();
    const key = `a:${ownerId}:${ids.length}`;
    // Beside the pin it would cover, never on it.
    result.clusters.push({
      key,
      ids,
      cx: owner.cx + (hitPx + clusterPx) / 2 + 2,
      cy: owner.cy,
      attachedTo: ownerId,
    });
    for (const id of ids) result.groups.set(id, key);
  }
  return result;
}
