/**
 * How much of the map the interface covers, as paddings for the camera: a card, the simulator
 * panel and the audio bar must never sit on top of the visitor or the road ahead. Pure: it takes
 * rectangles (relative to the map) and returns insets in px.
 */
export interface Rect {
  left: number;
  top: number;
  right: number;
  bottom: number;
}

export interface Insets {
  top: number;
  right: number;
  bottom: number;
  left: number;
}

const BASE_PX = 24;

export function insetsFromRects(
  map: { width: number; height: number },
  overlays: readonly Rect[],
): Insets {
  const insets = { top: 0, right: 0, bottom: 0, left: 0 };
  for (const rect of overlays) {
    const left = Math.max(0, rect.left);
    const top = Math.max(0, rect.top);
    const right = Math.min(map.width, rect.right);
    const bottom = Math.min(map.height, rect.bottom);
    if (right <= left || bottom <= top) continue; // not over the map
    const centreX = (left + right) / 2;
    const centreY = (top + bottom) / 2;
    // Give up the strip that costs the least: a panel in a corner either takes a band along
    // the top/bottom or along a side; keep whichever leaves more map to look at.
    const vertical =
      centreY < map.height / 2
        ? { edge: 'top' as const, inset: bottom }
        : { edge: 'bottom' as const, inset: map.height - top };
    const horizontal =
      centreX < map.width / 2
        ? { edge: 'left' as const, inset: right }
        : { edge: 'right' as const, inset: map.width - left };
    const keptByVertical = map.width * (map.height - vertical.inset);
    const keptByHorizontal = (map.width - horizontal.inset) * map.height;
    const chosen = keptByVertical >= keptByHorizontal ? vertical : horizontal;
    insets[chosen.edge] = Math.max(insets[chosen.edge], chosen.inset);
  }
  // Always leave a usable window, whatever is open.
  const limit = (a: number, b: number, size: number) => {
    const max = size * 0.75 - 2 * BASE_PX;
    const total = a + b;
    return total > max ? [(a / total) * max, (b / total) * max] : [a, b];
  };
  const [top, bottom] = limit(insets.top, insets.bottom, map.height);
  const [left, right] = limit(insets.left, insets.right, map.width);
  return {
    top: top! + BASE_PX,
    bottom: bottom! + BASE_PX,
    left: left! + BASE_PX,
    right: right! + BASE_PX,
  };
}
