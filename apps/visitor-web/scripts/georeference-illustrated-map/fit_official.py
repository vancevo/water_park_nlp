#!/usr/bin/env python3
"""Affine georeference of the official park map against the OSM footpaths.

    python3 apps/visitor-web/scripts/georeference-illustrated-map/fit_official.py

The official map is third-party artwork (rights not cleared, B01), so the image
is NOT in git: put it at `public/maps/local/damsen-official.png` (gitignored).
Only the numbers are committed (`public/maps/damsen-official.georef.json`).

It lays the OSM main lake (with its island) and the Khu B pond over the two
painted lakes, solving for an affine map (rotation + anisotropic scale + shear +
shift), and reports how well that worked. Lakes are found by colour, so this is
heuristic: check the printed IoUs and the overlay in the app.
"""

import json
import math
import random
from collections import deque
from pathlib import Path

import numpy as np
from PIL import Image, ImageDraw

HERE = Path(__file__).resolve().parent
APP = HERE.parents[1]
IMAGE = APP / "public/maps/local/damsen-official.png"
WALKWAYS = APP / "public/data/damsen-osm-walkways.geojson"
LAKES = HERE / "osm-lake-relation-5445124.json"
OUT = APP / "public/maps/damsen-official.georef.json"
LON0, LAT0 = 106.6385, 10.764
KX, KY = math.cos(math.radians(LAT0)) * 111320, 110574
K = 4  # work at 1/4 resolution


def to_m(lon, lat):
    return ((lon - LON0) * KX, (lat - LAT0) * KY)


def components(mask):
    h, w = mask.shape
    label = np.zeros((h, w), int)
    sizes, n = {}, 0
    for y0 in range(h):
        for x0 in range(w):
            if mask[y0, x0] and label[y0, x0] == 0:
                n += 1
                label[y0, x0] = n
                queue, size = deque([(y0, x0)]), 0
                while queue:
                    y, x = queue.popleft()
                    size += 1
                    for yy, xx in ((y + 1, x), (y - 1, x), (y, x + 1), (y, x - 1)):
                        if 0 <= yy < h and 0 <= xx < w and mask[yy, xx] and label[yy, xx] == 0:
                            label[yy, xx] = n
                            queue.append((yy, xx))
                sizes[n] = size
    return label, sizes


def close(mask, r):
    def dilate(a):
        out = a.copy()
        for k in range(1, r + 1):
            out[:-k] |= a[k:]
            out[k:] |= a[:-k]
        o2 = out.copy()
        for k in range(1, r + 1):
            o2[:, :-k] |= out[:, k:]
            o2[:, k:] |= out[:, :-k]
        return o2

    return ~dilate(~dilate(mask))


def painted_lakes(pixels):
    """(main lake mask, Khu B pond mask) at 1/K resolution."""
    n = pixels.shape[0] // K
    r, g, b = pixels[:, :, 0], pixels[:, :, 1], pixels[:, :, 2]
    water = (b >= g - 10) & (g > 90) & (r < 150) & (b > 110) & ((b - r) > 30)
    small = np.array(Image.fromarray(water.astype("uint8") * 255).resize((n, n), Image.NEAREST)) > 0
    label, sizes = components(small)
    ranked = sorted(sizes, key=lambda i: -sizes[i])
    main_id = ranked[0]
    my, mx = np.nonzero(label == main_id)
    box = (mx.min() - n // 12, mx.max() + n // 12, my.min() - n // 12, my.max() + n // 12)
    main_ids, pond_ids = [main_id], []
    for i in ranked[1:]:
        if sizes[i] < n * n * 0.0006:
            continue
        ys, xs = np.nonzero(label == i)
        cx, cy = xs.mean(), ys.mean()
        if box[0] <= cx <= box[1] and box[2] <= cy <= box[3]:
            main_ids.append(i)  # fragments of the main lake (lotus, jetty)
        elif cx < n * 0.4 and cy < n * 0.3:
            pond_ids.append(i)  # upper-left Khu B pond
    main = close(np.isin(label, main_ids), 6)
    pond = close(np.isin(label, pond_ids), 3)
    return main, pond


def ring(ways):
    ways = [[to_m(*p) for p in w] for w in ways]
    out = ways.pop(0)
    while ways:
        for i, w in enumerate(ways):
            if np.allclose(out[-1], w[0], atol=0.5):
                out += w[1:]
            elif np.allclose(out[-1], w[-1], atol=0.5):
                out += w[::-1][1:]
            else:
                continue
            ways.pop(i)
            break
        else:
            break
    return out


def main_fn():
    pixels = np.array(Image.open(IMAGE).convert("RGB")).astype(int)
    size = pixels.shape[0]
    n = size // K
    main, pond_mask = painted_lakes(pixels)
    water = main | pond_mask
    data = json.loads(LAKES.read_text())
    outer = ring([m["geometry"] for m in data["members"] if m["role"] == "outer"])
    inner = [[to_m(*p) for p in m["geometry"]] for m in data["members"] if m["role"] == "inner"]
    pond = [to_m(*p) for p in data["khuBPond"]["geometry"]]
    samples = []
    for f in json.loads(WALKWAYS.read_text())["features"]:
        pts = [to_m(*c) for c in f["geometry"]["coordinates"]]
        for p, q in zip(pts, pts[1:]):
            k = max(1, int(math.dist(p, q) / 3))
            samples += [(p[0] + (q[0] - p[0]) * i / k, p[1] + (q[1] - p[1]) * i / k) for i in range(k)]
    samples = np.array(samples)

    def apply(p, A):
        return (A[0] * p[0] + A[1] * p[1] + A[4], A[2] * p[0] + A[3] * p[1] + A[5])

    def raster(rings, holes, A):
        img = Image.new("L", (n, n), 0)
        d = ImageDraw.Draw(img)
        for r in rings:
            d.polygon([apply(p, A) for p in r], fill=1)
        for h in holes:
            d.polygon([apply(p, A) for p in h], fill=0)
        return np.array(img).astype(bool)

    def iou(a, b):
        u = (a | b).sum()
        return (a & b).sum() / u if u else 0.0

    def water_share(A):
        X = A[0] * samples[:, 0] + A[1] * samples[:, 1] + A[4]
        Y = A[2] * samples[:, 0] + A[3] * samples[:, 1] + A[5]
        ok = (X >= 0) & (X < n) & (Y >= 0) & (Y < n)
        return float(water[np.clip(Y.round().astype(int), 0, n - 1), np.clip(X.round().astype(int), 0, n - 1)][ok].mean())

    def score(A):
        i1, i2, ws = iou(raster([outer], inner, A), main), iou(raster([pond], [], A), pond_mask), water_share(A)
        return i1 + 0.6 * i2 - 2 * ws, i1, i2, ws

    def similarity(s, deg, tx, ty):
        t = math.radians(deg)
        c, sn = math.cos(t), math.sin(t)
        return [s * c, -s * sn, -s * sn, -s * c, tx, ty]  # image y points down

    area = 0.5 * abs(sum(outer[i][0] * outer[(i + 1) % len(outer)][1] - outer[(i + 1) % len(outer)][0] * outer[i][1] for i in range(len(outer))))
    s0 = math.sqrt(main.sum() / area)
    ys, xs = np.nonzero(main)
    O = np.array(outer)
    best = None
    for deg in range(0, 360, 4):
        t = math.radians(deg)
        c, sn = math.cos(t), math.sin(t)
        tx = xs.mean() - s0 * (c * O[:, 0].mean() - sn * O[:, 1].mean())
        ty = ys.mean() + s0 * (sn * O[:, 0].mean() + c * O[:, 1].mean())
        A = similarity(s0, deg, tx, ty)
        sc = score(A)
        if best is None or sc[0] > best[0][0]:
            best = (sc, deg, A)
    sim_scores, deg0, A = best
    current = (score(A)[0], A)
    rng = random.Random(3)
    for it in range(4000):
        k = 0.3 if it > 2500 else 1.0
        B = [
            A[0] * (1 + rng.gauss(0, 0.01 * k)),
            A[1] + rng.gauss(0, 0.01 * k) * abs(A[0]),
            A[2] + rng.gauss(0, 0.01 * k) * abs(A[0]),
            A[3] * (1 + rng.gauss(0, 0.01 * k)),
            A[4] + rng.gauss(0, 1.2 * k),
            A[5] + rng.gauss(0, 1.2 * k),
        ]
        if score(B)[0] > current[0]:
            current, A = (score(B)[0], B), B
    final = score(current[1])
    A = current[1]  # metres -> pixels at 1/K scale
    a, b, c, d, tx, ty = [v * K for v in A]  # -> full resolution
    det = a * d - b * c

    def pixel_to_lonlat(X, Y):
        x = (d * (X - tx) - b * (Y - ty)) / det
        y = (-c * (X - tx) + a * (Y - ty)) / det
        return [round(LON0 + x / KX, 7), round(LAT0 + y / KY, 7)]

    result = {
        "status": "provisional",
        "method": "affine fit of the OSM main lake (+island) and Khu B pond to the painted lakes",
        "image": "local/damsen-official.jpg",
        "imageLocalOnly": True,
        "imageSizePx": size,
        "rotationDegreesCoarse": deg0,
        "metresPerPixel": [round(1 / math.hypot(a, c), 3), round(1 / math.hypot(b, d), 3)],
        "mainLakeIoU": round(final[1], 3),
        "khuBPondIoU": round(final[2], 3),
        "osmFootpathSamplesOnPaintedWater": round(final[3], 3),
        "similarityOnlyBaseline": {"mainLakeIoU": round(sim_scores[1], 3), "khuBPondIoU": round(sim_scores[2], 3)},
        "note": "Two-lake affine fit; lakes found by colour. Verify visually and on site before trusting.",
        "corners": [pixel_to_lonlat(0, 0), pixel_to_lonlat(size, 0), pixel_to_lonlat(size, size), pixel_to_lonlat(0, size)],
    }
    OUT.write_text(json.dumps(result, indent=2) + "\n")
    print(json.dumps({k: v for k, v in result.items() if k != "corners"}, indent=2))


if __name__ == "__main__":
    main_fn()
