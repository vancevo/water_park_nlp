#!/usr/bin/env python3
"""Georeference a map picture that draws its footpaths as cream lines (no scipy/cv2).

    python3 apps/visitor-web/scripts/georeference-illustrated-map/fit_paths.py \
        --image apps/visitor-web/public/maps/damsen-illustrated-3.jpg \
        --out apps/visitor-web/public/maps/damsen-illustrated-3.georef.json

Extracts the cream path network from the picture, then solves the affine map
(rotation, scale, shear, shift) that puts the OSM footpaths (`damsen-osm-walkways.geojson`)
on top of those painted paths by minimising the mean distance from every OSM sample
to the nearest painted path pixel. It then checks the fit against something it was NOT
fitted to: the OSM lakes versus the water painted in the picture.
"""

import argparse
import json
import math
import random
from collections import deque
from pathlib import Path

import numpy as np
from PIL import Image, ImageDraw

HERE = Path(__file__).resolve().parent
APP = HERE.parents[1]
WALKWAYS = APP / "public/data/damsen-osm-walkways.geojson"
LAKES = HERE / "osm-lake-relation-5445124.json"
LON0, LAT0 = 106.6385, 10.764
KX, KY = math.cos(math.radians(LAT0)) * 111320, 110574
K = 2  # work at 1/K resolution
MAX_DIST = 40


def to_m(lon, lat):
    return ((lon - LON0) * KX, (lat - LAT0) * KY)


def components(mask, eight=False):
    h, w = mask.shape
    label = np.zeros((h, w), int)
    sizes, n = {}, 0
    steps = ((1, 0), (-1, 0), (0, 1), (0, -1)) + (((1, 1), (-1, -1), (1, -1), (-1, 1)) if eight else ())
    for y0 in range(h):
        for x0 in range(w):
            if mask[y0, x0] and label[y0, x0] == 0:
                n += 1
                label[y0, x0] = n
                queue, size = deque([(y0, x0)]), 0
                while queue:
                    y, x = queue.popleft()
                    size += 1
                    for dy, dx in steps:
                        yy, xx = y + dy, x + dx
                        if 0 <= yy < h and 0 <= xx < w and mask[yy, xx] and label[yy, xx] == 0:
                            label[yy, xx] = n
                            queue.append((yy, xx))
                sizes[n] = size
    return label, sizes


def distance_to(mask):
    """Chebyshev distance to the mask, capped at MAX_DIST."""
    dist = np.full(mask.shape, MAX_DIST, np.int16)
    dist[mask] = 0
    cur = mask.copy()
    for r in range(1, MAX_DIST):
        d = cur.copy()
        d[1:] |= cur[:-1]
        d[:-1] |= cur[1:]
        d2 = d.copy()
        d2[:, 1:] |= d[:, :-1]
        d2[:, :-1] |= d[:, 1:]
        dist[d2 & ~cur] = r
        cur = d2
    return dist


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


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--image", type=Path, required=True)
    ap.add_argument("--out", type=Path, required=True)
    args = ap.parse_args()

    pixels = np.array(Image.open(args.image).convert("RGB")).astype(int)
    height, width = pixels.shape[:2]
    r, g, b = pixels[:, :, 0], pixels[:, :, 1], pixels[:, :, 2]
    cream = (r >= 238) & (g >= 212) & (b >= 150) & (b <= 228) & (r - b >= 18)
    w, h = width // K, height // K

    def small(mask):
        return np.array(Image.fromarray(mask.astype("uint8") * 255).resize((w, h), Image.NEAREST)) > 0

    label, sizes = components(small(cream), eight=True)
    paths = np.isin(label, [i for i, s in sizes.items() if s > 600])  # drop sand patches
    dist = distance_to(paths)

    samples = []
    for f in json.loads(WALKWAYS.read_text())["features"]:
        pts = [to_m(*c) for c in f["geometry"]["coordinates"]]
        for p, q in zip(pts, pts[1:]):
            n = max(1, int(math.dist(p, q) / 2))
            samples += [(p[0] + (q[0] - p[0]) * i / n, p[1] + (q[1] - p[1]) * i / n) for i in range(n)]
    samples = np.array(samples)

    def cost(A):
        X = A[0] * samples[:, 0] + A[1] * samples[:, 1] + A[4]
        Y = A[2] * samples[:, 0] + A[3] * samples[:, 1] + A[5]
        xi, yi = np.round(X).astype(int), np.round(Y).astype(int)
        ok = (xi >= 0) & (xi < w) & (yi >= 0) & (yi < h)
        d = np.where(ok, dist[np.clip(yi, 0, h - 1), np.clip(xi, 0, w - 1)], MAX_DIST)
        return float(d.mean()), float((d <= 3).mean())

    ys, xs = np.nonzero(paths)
    ox0, ox1, oy0, oy1 = samples[:, 0].min(), samples[:, 0].max(), samples[:, 1].min(), samples[:, 1].max()
    s = ((xs.max() - xs.min()) / (ox1 - ox0) + (ys.max() - ys.min()) / (oy1 - oy0)) / 2  # north-up start
    A = [s, 0, 0, -s, (xs.min() + xs.max()) / 2 - s * (ox0 + ox1) / 2, (ys.min() + ys.max()) / 2 + s * (oy0 + oy1) / 2]
    start = cost(A)
    best = (start[0], A)
    rng = random.Random(2)
    for it in range(6000):
        f = 0.25 if it > 3500 else 1.0
        B = [
            A[0] * (1 + rng.gauss(0, 0.004 * f)),
            A[1] + rng.gauss(0, 0.004 * f) * abs(A[0]),
            A[2] + rng.gauss(0, 0.004 * f) * abs(A[0]),
            A[3] * (1 + rng.gauss(0, 0.004 * f)),
            A[4] + rng.gauss(0, 1.0 * f),
            A[5] + rng.gauss(0, 1.0 * f),
        ]
        if (c := cost(B)[0]) < best[0]:
            best, A = (c, B), B
    mean_px, within3 = cost(A)
    a, b_, c_, d_, tx, ty = [v * K for v in A]  # -> full resolution
    det = a * d_ - b_ * c_
    m_per_px = [1 / math.hypot(a, c_), 1 / math.hypot(b_, d_)]

    # Independent check: OSM lakes vs the water painted in the picture (not used in the fit).
    water = (r < 110) & (g > 100) & (b > 100) & (np.abs(b - g) < 45) & (b + g > 220)
    water_small = small(water)
    data = json.loads(LAKES.read_text())
    outer = ring([m["geometry"] for m in data["members"] if m["role"] == "outer"])
    inner = [[to_m(*p) for p in m["geometry"]] for m in data["members"] if m["role"] == "inner"]
    pond = [to_m(*p) for p in data["khuBPond"]["geometry"]]
    img = Image.new("L", (w, h), 0)
    draw = ImageDraw.Draw(img)

    def px(p):
        return (A[0] * p[0] + A[1] * p[1] + A[4], A[2] * p[0] + A[3] * p[1] + A[5])

    draw.polygon([px(p) for p in outer], fill=1)
    draw.polygon([px(p) for p in pond], fill=1)
    for hole in inner:
        draw.polygon([px(p) for p in hole], fill=0)
    lake = np.array(img).astype(bool)
    inside = water_small[lake].mean() if lake.any() else 0.0  # share of OSM lake that is painted water
    lake_iou = float((lake & water_small).sum() / max(1, (lake | water_small).sum()))

    def pixel_to_lonlat(X, Y):
        x = (d_ * (X - tx) - b_ * (Y - ty)) / det
        y = (-c_ * (X - tx) + a * (Y - ty)) / det
        return [round(LON0 + x / KX, 7), round(LAT0 + y / KY, 7)]

    result = {
        "status": "fitted-to-osm-paths",
        "method": "affine fit of the OSM footpaths onto the cream paths painted in the picture",
        "image": args.image.name,
        "imageSizePx": [width, height],
        "rotationDegrees": round(math.degrees(math.atan2(-c_, a)), 2),
        "metresPerPixel": [round(m_per_px[0], 3), round(m_per_px[1], 3)],
        "meanDistanceMetres": round(mean_px * K * (m_per_px[0] + m_per_px[1]) / 2, 2),
        "osmPathSamplesWithin3HalfPixels": round(within3, 3),
        "startingGuessWithin3HalfPixels": round(start[1], 3),
        "independentCheck": {
            "osmLakeCoveredByPaintedWater": round(float(inside), 3),
            "osmLakeVsPaintedWaterIoU": round(lake_iou, 3),
        },
        "note": "Paths were fitted; the lake check is independent. The picture's paths are not surveyed: verify on site.",
        "corners": [pixel_to_lonlat(0, 0), pixel_to_lonlat(width, 0), pixel_to_lonlat(width, height), pixel_to_lonlat(0, height)],
    }
    args.out.write_text(json.dumps(result, indent=2) + "\n")
    print(json.dumps({k: v for k, v in result.items() if k != "corners"}, indent=2))


if __name__ == "__main__":
    main()
