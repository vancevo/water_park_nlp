#!/usr/bin/env python3
"""Provisional georeference of the illustrated Dam Sen map (no scipy/cv2 needed).

    python3 apps/visitor-web/scripts/georeference-illustrated-map/fit.py

Finds the similarity transform (rotation, uniform scale, shift) that best lays
the OSM lake (relation 5445124, island included) over the lake painted in
`public/maps/damsen-illustrated.jpg`, then reports how many real OSM footpath
samples land on painted water. Writes `public/maps/damsen-illustrated.georef.json`
(image corners as lon/lat for a MapLibre `image` source) with the quality numbers.
A rigid fit cannot undo the artist's distortions, so the result is "provisional":
use it to *compare* the two maps, not to navigate.
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
IMAGE = APP / "public/maps/damsen-illustrated.jpg"
WALKWAYS = APP / "public/data/damsen-osm-walkways.geojson"
LAKE = HERE / "osm-lake-relation-5445124.json"
OUT = APP / "public/maps/damsen-illustrated.georef.json"

LON0, LAT0 = 106.6385, 10.764
KX, KY = math.cos(math.radians(LAT0)) * 111320, 110574  # metres per degree


def to_m(lon, lat):
    return ((lon - LON0) * KX, (lat - LAT0) * KY)


def painted_lake(pixels):
    """Largest cyan-blue blob (the main lake), label holes closed."""
    water = (pixels[:, :, 0] < 110) & (pixels[:, :, 1] > 140) & (pixels[:, :, 2] > 200)
    h, w = water.shape
    label = np.zeros((h, w), int)
    best, best_n = 0, 0
    n = 0
    for y0 in range(h):
        for x0 in range(w):
            if water[y0, x0] and label[y0, x0] == 0:
                n += 1
                label[y0, x0] = n
                queue, size = deque([(y0, x0)]), 0
                while queue:
                    y, x = queue.popleft()
                    size += 1
                    for yy, xx in ((y + 1, x), (y - 1, x), (y, x + 1), (y, x - 1)):
                        if 0 <= yy < h and 0 <= xx < w and water[yy, xx] and label[yy, xx] == 0:
                            label[yy, xx] = n
                            queue.append((yy, xx))
                if size > best:
                    best, best_n = size, n
    main = label == best_n

    def dilate(a, r):
        out = a.copy()
        for k in range(1, r + 1):
            out[:-k] |= a[k:]
            out[k:] |= a[:-k]
        o2 = out.copy()
        for k in range(1, r + 1):
            o2[:, :-k] |= out[:, k:]
            o2[:, k:] |= out[:, :-k]
        return o2

    return ~dilate(~dilate(main, 14), 14), water


def lake_rings():
    data = json.loads(LAKE.read_text())
    ways = [[to_m(*p) for p in m["geometry"]] for m in data["members"] if m["role"] == "outer"]
    ring = ways.pop(0)
    while ways:
        for i, way in enumerate(ways):
            if np.allclose(ring[-1], way[0], atol=0.5):
                ring += way[1:]
            elif np.allclose(ring[-1], way[-1], atol=0.5):
                ring += way[::-1][1:]
            else:
                continue
            ways.pop(i)
            break
        else:
            break
    inner = [[to_m(*p) for p in m["geometry"]] for m in data["members"] if m["role"] == "inner"]
    return ring, inner


def transform(point, scale, theta, tx, ty):
    x, y = point
    c, s = math.cos(theta), math.sin(theta)
    return (scale * (c * x - s * y) + tx, -scale * (s * x + c * y) + ty)  # image y points down


def raster(ring, inner, scale, deg, tx, ty, size):
    img = Image.new("L", (size, size), 0)
    draw = ImageDraw.Draw(img)
    theta = math.radians(deg)
    draw.polygon([transform(p, scale, theta, tx, ty) for p in ring], fill=1)
    for hole in inner:
        draw.polygon([transform(p, scale, theta, tx, ty) for p in hole], fill=0)
    return np.array(img).astype(bool)


def downsample(a, k=3):
    h, w = a.shape[0] // k * k, a.shape[1] // k * k
    return a[:h, :w].reshape(h // k, k, w // k, k).mean((1, 3)) > 0.5


def walkway_samples():
    samples = []
    for feature in json.loads(WALKWAYS.read_text())["features"]:
        pts = [to_m(*c) for c in feature["geometry"]["coordinates"]]
        for p, q in zip(pts, pts[1:]):
            n = max(1, int(math.dist(p, q) / 3))
            samples += [(p[0] + (q[0] - p[0]) * i / n, p[1] + (q[1] - p[1]) * i / n) for i in range(n)]
    return np.array(samples)


def main():
    pixels = np.array(Image.open(IMAGE).convert("RGB")).astype(int)
    size = pixels.shape[0]
    lake, water = painted_lake(pixels)
    ring, inner = lake_rings()
    samples = walkway_samples()
    lake_small = downsample(lake)
    area = 0.5 * abs(
        sum(ring[i][0] * ring[(i + 1) % len(ring)][1] - ring[(i + 1) % len(ring)][0] * ring[i][1] for i in range(len(ring)))
    )
    scale0 = math.sqrt(lake.sum() / area)
    ys, xs = np.nonzero(lake)

    def water_share(scale, deg, tx, ty):
        c, s = math.cos(math.radians(deg)), math.sin(math.radians(deg))
        X = scale * (c * samples[:, 0] - s * samples[:, 1]) + tx
        Y = -scale * (s * samples[:, 0] + c * samples[:, 1]) + ty
        xi = np.clip(np.round(X).astype(int), 0, size - 1)
        yi = np.clip(np.round(Y).astype(int), 0, size - 1)
        return float(water[yi, xi].mean())

    def iou(scale, deg, tx, ty):
        r = downsample(raster(ring, inner, scale, deg, tx, ty, size))
        return float((r & lake_small).sum() / max(1, (r | lake_small).sum()))

    def objective(scale, deg, tx, ty):
        return iou(scale, deg, tx, ty) - 2 * water_share(scale, deg, tx, ty)

    north_up = None
    best = (-9, 0, 0, 0)
    for deg in range(0, 360, 6):  # coarse rotation search, centroids aligned
        r = raster(ring, inner, scale0, deg, 0, 0, size * 3)  # large canvas for the centroid
        rs, cs = np.nonzero(r)
        tx, ty = xs.mean() - cs.mean(), ys.mean() - rs.mean()
        value = objective(scale0, deg, tx, ty)
        if deg == 0:
            north_up = (iou(scale0, 0, tx, ty), water_share(scale0, 0, tx, ty))
        if value > best[0]:
            best = (value, deg, tx, ty)
    _, deg, tx, ty = best
    current = (objective(scale0, deg, tx, ty), deg, scale0, tx, ty)
    rng = random.Random(7)
    for it in range(1500):
        k = 0.5 if it > 800 else 1.0
        cand = (
            current[1] + rng.gauss(0, 3 * k),
            current[2] * math.exp(rng.gauss(0, 0.02 * k)),
            current[3] + rng.gauss(0, 8 * k),
            current[4] + rng.gauss(0, 8 * k),
        )
        value = objective(cand[1], cand[0], cand[2], cand[3])
        if value > current[0]:
            current = (value,) + cand
    _, deg, scale, tx, ty = current

    theta = math.radians(deg)
    c, s = math.cos(theta), math.sin(theta)

    def pixel_to_lonlat(X, Y):
        u, v = (X - tx) / scale, -(Y - ty) / scale
        x, y = c * u + s * v, -s * u + c * v
        return [round(LON0 + x / KX, 7), round(LAT0 + y / KY, 7)]

    result = {
        "status": "provisional",
        "method": "similarity transform from the OSM lake (relation 5445124) to the painted lake",
        "image": "damsen-illustrated.jpg",
        "imageSizePx": size,
        "rotationDegrees": round(deg, 1),
        "pixelsPerMetre": round(scale, 3),
        "lakeOverlapIoU": round(iou(scale, deg, tx, ty), 3),
        "osmFootpathSamplesOnPaintedWater": round(water_share(scale, deg, tx, ty), 3),
        "northUpBaseline": {"lakeOverlapIoU": round(north_up[0], 3), "footpathsOnWater": round(north_up[1], 3)},
        "note": "A rigid fit cannot remove the artist's distortions. Compare, do not navigate by it.",
        "corners": [pixel_to_lonlat(0, 0), pixel_to_lonlat(size, 0), pixel_to_lonlat(size, size), pixel_to_lonlat(0, size)],
    }
    OUT.write_text(json.dumps(result, indent=2) + "\n")
    print(json.dumps({k: v for k, v in result.items() if k != "corners"}, indent=2))


if __name__ == "__main__":
    main()
