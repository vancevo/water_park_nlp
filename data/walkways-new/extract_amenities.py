#!/usr/bin/env python3
"""Find the service icons (food, toilets, parking, first aid, security) in the icons layer of the
official park map and cut them out as sprites.

    python3 data/walkways-new/extract_amenities.py ICONS.png          # RGBA, same frame as the map

Prints each icon's centre in the 2048x1315 frame of the map picture (data/pois/amenities.json uses
those pixels) and writes the sprites to apps/visitor-web/public/icons/svc-<kind>.png.
Classification by colour: red disc = food, purple = toilet, grey disc = parking, the yellow double
box = first aid (left) + security (right). The five toilets with a wheelchair glyph (some are drawn
tilted, so size is no help) are listed in ACCESSIBLE, read off the icons image.
"""
import sys
from collections import deque
from pathlib import Path

import numpy as np
from PIL import Image

OUT = Path(__file__).resolve().parents[2] / "apps/visitor-web/public/icons"
SPRITE = 96  # px, for a ~28 px marker on a 3x screen
# Toilets with the wheelchair glyph, centres in the 2048x1315 frame (matched within 12 px).
ACCESSIBLE = [(755, 370), (1134, 454), (893, 631), (1793, 479), (1732, 664)]


def components(alpha):
    small = alpha[::4, ::4] > 20
    h, w = small.shape
    seen = np.zeros_like(small, bool)
    for y, x in zip(*np.nonzero(small)):
        if seen[y, x]:
            continue
        queue, pts = deque([(y, x)]), []
        seen[y, x] = True
        while queue:
            cy, cx = queue.popleft()
            pts.append((cy, cx))
            for dy in range(-3, 4):
                for dx in range(-3, 4):
                    ny, nx = cy + dy, cx + dx
                    if 0 <= ny < h and 0 <= nx < w and small[ny, nx] and not seen[ny, nx]:
                        seen[ny, nx] = True
                        queue.append((ny, nx))
        if len(pts) > 8:
            pts = np.array(pts)
            y0, x0 = pts.min(0) * 4
            y1, x1 = (pts.max(0) + 1) * 4
            yield x0, y0, x1, y1


def sprite(img, box):
    crop = img.crop(box)
    side = max(crop.size)
    square = Image.new("RGBA", (side, side), (0, 0, 0, 0))
    square.paste(crop, ((side - crop.width) // 2, (side - crop.height) // 2))
    return square.resize((SPRITE, SPRITE), Image.LANCZOS)


def main():
    img = Image.open(sys.argv[1]).convert("RGBA")
    scale = img.width / 2048  # icon layer pixels per map pixel
    arr = np.array(img)
    found = []
    for x0, y0, x1, y1 in components(arr[..., 3]):
        px = arr[y0:y1, x0:x1]
        colour = np.median(px[px[..., 3] > 128][:, :3], axis=0)
        r, g, b = colour
        if r > 200 and g > 190 and b < 90:
            kind = "yellow-box"
        elif r > 180 and g < 120 and b < 120:
            kind = "food"
        elif b - r > 15 and b > g:
            cx, cy = (x0 + x1) / 2 / scale, (y0 + y1) / 2 / scale
            kind = "wc-access" if any(abs(cx - ax) < 12 and abs(cy - ay) < 12 for ax, ay in ACCESSIBLE) else "wc"
        else:
            kind = "parking"
        found.append((kind, (x0, y0, x1, y1)))
    OUT.mkdir(parents=True, exist_ok=True)
    seen = set()
    rows = []
    for kind, (x0, y0, x1, y1) in found:
        if kind == "yellow-box":
            mid = (x0 + x1) // 2
            gap = int(2 * scale)  # keep the seam between the two icons out of the sprites
            for name, box in (("first-aid", (x0, y0, mid - gap, y1)), ("security", (mid + gap, y0, x1, y1))):
                rows.append((name, ((box[0] + box[2]) / 2 / scale, (box[1] + box[3]) / 2 / scale)))
                if name not in seen:
                    sprite(img, box).save(OUT / f"svc-{name}.png")
                    seen.add(name)
            continue
        rows.append((kind, ((x0 + x1) / 2 / scale, (y0 + y1) / 2 / scale)))
        if kind not in seen:
            sprite(img, (x0, y0, x1, y1)).save(OUT / f"svc-{kind}.png")
            seen.add(kind)
    for kind, (x, y) in sorted(rows, key=lambda r: (r[0], r[1][1], r[1][0])):
        print(f"{kind:10s} {x:7.1f} {y:7.1f}")
    print(len(rows), "icons;", sorted(seen))


if __name__ == "__main__":
    main()
