import { describe, expect, it } from 'vitest';
import {
  PIN_SIZE_MAX,
  PIN_SIZE_MIN,
  layoutMarkers,
  pinSizeForZoom,
  type LayoutOptions,
  type LayoutPoint,
} from './marker-layout';

const view: LayoutOptions = {
  hitPx: 28,
  clusterPx: 34,
  viewport: { width: 800, height: 600 },
};
const at = (
  id: string,
  cx: number,
  cy: number,
  priority = false,
): LayoutPoint => ({
  id,
  cx,
  cy,
  priority,
});
const ids = (r: ReturnType<typeof layoutMarkers>) =>
  [...r.singles, ...r.clusters.flatMap((c) => c.ids)].sort();

describe('pin size by zoom', () => {
  it('is 20 px at the whole-park zoom, 28 one level in, 36 two in, clamped 16–40', () => {
    expect(pinSizeForZoom(15, 15)).toBe(20);
    expect(pinSizeForZoom(16, 15)).toBe(28);
    expect(pinSizeForZoom(17, 15)).toBe(36);
    expect(pinSizeForZoom(22, 15)).toBe(PIN_SIZE_MAX);
    expect(pinSizeForZoom(10, 15)).toBe(PIN_SIZE_MIN);
    expect(pinSizeForZoom(15.5, 15)).toBeCloseTo(24, 5);
  });
});

describe('clustering', () => {
  it('draws separate pins alone and groups pins whose touch areas overlap', () => {
    const r = layoutMarkers(
      [
        at('a', 100, 100),
        at('b', 300, 100),
        at('c', 110, 110),
        at('d', 118, 100),
      ],
      view,
    );
    expect(r.singles.sort()).toEqual(['b']);
    expect(r.clusters).toHaveLength(1);
    expect(r.clusters[0]!.ids).toEqual(['a', 'c', 'd']);
  });

  it('every visible id appears exactly once, never twice or lost', () => {
    const points = Array.from({ length: 60 }, (_, i) =>
      at(`p${i}`, (i * 37) % 700, (i * 53) % 500),
    );
    const r = layoutMarkers(points, view);
    expect(ids(r)).toEqual(points.map((p) => p.id).sort());
    expect(new Set(r.groups.keys()).size).toBe(points.length);
  });

  it('no two drawn items overlap once the layout has settled', () => {
    const points = Array.from({ length: 77 }, (_, i) =>
      at(`p${i}`, 40 + ((i * 97) % 700), 40 + ((i * 61) % 500)),
    );
    const r = layoutMarkers(points, view);
    const boxes = [
      ...r.singles.map((id) => {
        const p = points.find((q) => q.id === id)!;
        return { cx: p.cx, cy: p.cy, size: view.hitPx };
      }),
      ...r.clusters.map((c) => ({ cx: c.cx, cy: c.cy, size: view.clusterPx })),
    ];
    for (let i = 0; i < boxes.length; i += 1) {
      for (let j = i + 1; j < boxes.length; j += 1) {
        const reach = (boxes[i]!.size + boxes[j]!.size) / 2;
        const clear =
          Math.abs(boxes[i]!.cx - boxes[j]!.cx) >= reach ||
          Math.abs(boxes[i]!.cy - boxes[j]!.cy) >= reach;
        expect(clear, `${i} vs ${j}`).toBe(true);
      }
    }
  });

  it('keeps places with identical coordinates together', () => {
    const r = layoutMarkers([at('a', 200, 200), at('b', 200, 200)], view);
    expect(r.clusters[0]!.ids).toEqual(['a', 'b']);
  });

  it('does not lay out what is far outside the viewport', () => {
    const r = layoutMarkers([at('in', 100, 100), at('out', 5000, 100)], view);
    expect(r.singles).toEqual(['in']);
    expect(r.offscreen).toEqual(['out']);
  });
});

describe('priority pins (selected, destination, playing)', () => {
  it('stay alone and out of any cluster count; touching pins fold beside them', () => {
    const r = layoutMarkers(
      [
        at('sel', 200, 200, true),
        at('x', 205, 205),
        at('y', 215, 200),
        at('far', 500, 400),
      ],
      view,
    );
    expect(r.singles.sort()).toEqual(['far', 'sel']);
    expect(r.clusters).toHaveLength(1);
    expect(r.clusters[0]).toMatchObject({ ids: ['x', 'y'], attachedTo: 'sel' });
    // beside, not on top
    expect(r.clusters[0]!.cx).toBeGreaterThan(200 + view.hitPx);
    expect(ids(r)).toEqual(['far', 'sel', 'x', 'y']);
  });

  it('two priority pins on one spot both stay drawn', () => {
    const r = layoutMarkers(
      [at('a', 100, 100, true), at('b', 100, 100, true)],
      view,
    );
    expect(r.singles.sort()).toEqual(['a', 'b']);
  });
});

describe('stability', () => {
  it('a pair that was together stays together a little longer', () => {
    const points = [at('a', 100, 100), at('b', 100 + 28 + 3, 100)]; // just apart
    const apart = layoutMarkers(points, view);
    expect(apart.clusters).toHaveLength(0);
    const together = layoutMarkers(points, {
      ...view,
      previous: new Map([
        ['a', 'c:a:2'],
        ['b', 'c:a:2'],
      ]),
    });
    expect(together.clusters).toHaveLength(1);
  });

  it('gives the same result whatever the order of the input', () => {
    const points = [at('a', 100, 100), at('b', 110, 100), at('c', 400, 300)];
    const one = layoutMarkers(points, view);
    const two = layoutMarkers([...points].reverse(), view);
    expect(one.clusters.map((c) => c.key)).toEqual(
      two.clusters.map((c) => c.key),
    );
    expect(one.singles.sort()).toEqual(two.singles.sort());
  });
});
