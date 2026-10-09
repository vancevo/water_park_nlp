#!/usr/bin/env python3
"""Affine georeference of a map picture by its park outline + lakes (no scipy/cv2).

    python3 apps/visitor-web/scripts/georeference-illustrated-map/fit_silhouette.py \
        --image apps/visitor-web/public/maps/damsen-illustrated-2.jpg \
        --out apps/visitor-web/public/maps/damsen-illustrated-2.georef.json \
        --ignore 540,0,9999,155 --ignore 30,220,195,270

Works for stylized pictures that draw the park on a plain background (pale
corner colour): the silhouette of everything that is not background is laid over
the OSM park boundary (way 32735046) together with the painted lakes over the
OSM lake, solving an affine map (rotation, scale, shear, shift). `--ignore x0,y0,x1,y1`
masks title/logo/label boxes. Provisional: check the printed IoUs and the overlay.
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
PARK = HERE / "osm-park-boundary-32735046.json"
LON0, LAT0 = 106.6385, 10.764
KX, KY = math.cos(math.radians(LAT0)) * 111320, 110574
WORK = 520  # longest side of the working raster


def to_m(lon, lat):
    return ((lon - LON0) * KX, (lat - LAT0) * KY)


def flood(mask, seeds_of_interest=None):
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


def fill_holes(mask):
    h, w = mask.shape
    outside = ~mask
    seen = np.zeros_like(mask)
    queue = deque([(0, 0)])
    seen[0, 0] = True
    while queue:
        y, x = queue.popleft()
        for yy, xx in ((y + 1, x), (y - 1, x), (y, x + 1), (y, x - 1)):
            if 0 <= yy < h and 0 <= xx < w and outside[yy, xx] and not seen[yy, xx]:
                seen[yy, xx] = True
                queue.append((yy, xx))
    return ~seen


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
    ap.add_argument("--ignore", action="append", default=[], help="x0,y0,x1,y1 in image pixels")
    ap.add_argument("--background", help="r,g,b of the plain background (default: top-left corner)")
    ap.add_argument("--mirror", action="store_true", help="also try mirrored layouts (off: a map is not mirrored)")
    ap.add_argument("--w-park", type=float, default=1.0, help="weight of the park outline overlap")
    ap.add_argument("--w-lake", type=float, default=0.6, help="weight of the lake overlap")
    args = ap.parse_args()

    pixels = np.array(Image.open(args.image).convert("RGB")).astype(int)
    height, width = pixels.shape[:2]
    bg = np.array(list(map(int, args.background.split(",")))) if args.background else pixels[:12, :12].reshape(-1, 3).mean(0)
    k = max(height, width) / WORK  # image px per working px
    nw, nh = round(width / k), round(height / k)

    def small(mask):
        return np.array(Image.fromarray(mask.astype("uint8") * 255).resize((nw, nh), Image.NEAREST)) > 0

    ignore = np.zeros((height, width), bool)
    for box in args.ignore:
        x0, y0, x1, y1 = map(int, box.split(","))
        ignore[y0:y1, x0:x1] = True
    park_px = (np.abs(pixels - bg).sum(2) > 40) & ~ignore
    silhouette = fill_holes(close(small(park_px), 3))
    label, sizes = flood(silhouette)
    keep = [i for i, s in sizes.items() if s > 0.02 * nw * nh]
    silhouette = np.isin(label, keep)
    water = (pixels[:, :, 0] < 110) & (pixels[:, :, 1] > 140) & (pixels[:, :, 2] > 200) & ~ignore
    wl, ws = flood(small(water))
    lakes = close(np.isin(wl, [i for i, s in sorted(ws.items(), key=lambda kv: -kv[1])[:2] if s > 0.002 * nw * nh]), 3)
    print("working size", nw, nh, "silhouette", int(silhouette.sum()), "lakes", int(lakes.sum()))

    data = json.loads(LAKES.read_text())
    outer = ring([m["geometry"] for m in data["members"] if m["role"] == "outer"])
    inner = [[to_m(*p) for p in m["geometry"]] for m in data["members"] if m["role"] == "inner"]
    boundary = [to_m(*p) for p in json.loads(PARK.read_text())["geometry"]]
    samples = []
    for f in json.loads(WALKWAYS.read_text())["features"]:
        pts = [to_m(*c) for c in f["geometry"]["coordinates"]]
        for p, q in zip(pts, pts[1:]):
            n = max(1, int(math.dist(p, q) / 3))
            samples += [(p[0] + (q[0] - p[0]) * i / n, p[1] + (q[1] - p[1]) * i / n) for i in range(n)]
    samples = np.array(samples)

    def apply(p, A):
        return (A[0] * p[0] + A[1] * p[1] + A[4], A[2] * p[0] + A[3] * p[1] + A[5])

    def raster(rings, holes, A):
        img = Image.new("L", (nw, nh), 0)
        d = ImageDraw.Draw(img)
        for r in rings:
            d.polygon([apply(p, A) for p in r], fill=1)
        for h in holes:
            d.polygon([apply(p, A) for p in h], fill=0)
        return np.array(img).astype(bool)

    def iou(a, b):
        u = (a | b).sum()
        return float((a & b).sum() / u) if u else 0.0

    def water_share(A):
        X = A[0] * samples[:, 0] + A[1] * samples[:, 1] + A[4]
        Y = A[2] * samples[:, 0] + A[3] * samples[:, 1] + A[5]
        ok = (X >= 0) & (X < nw) & (Y >= 0) & (Y < nh)
        hit = lakes[np.clip(Y.round().astype(int), 0, nh - 1), np.clip(X.round().astype(int), 0, nw - 1)]
        return float(hit[ok].mean()) if ok.any() else 1.0

    def inside_share(A):
        X = A[0] * samples[:, 0] + A[1] * samples[:, 1] + A[4]
        Y = A[2] * samples[:, 0] + A[3] * samples[:, 1] + A[5]
        ok = (X >= 0) & (X < nw) & (Y >= 0) & (Y < nh)
        hit = silhouette[np.clip(Y.round().astype(int), 0, nh - 1), np.clip(X.round().astype(int), 0, nw - 1)]
        return float((hit & ok).mean())

    def score(A):
        i_park = iou(raster([boundary], [], A), silhouette)
        i_lake = iou(raster([outer], inner, A), lakes)
        ws, inside = water_share(A), inside_share(A)
        return args.w_park * i_park + args.w_lake * i_lake - 2 * ws + 0.5 * inside, i_park, i_lake, ws, inside

    def similarity(s, deg, tx, ty, flip):
        t = math.radians(deg)
        c, sn = math.cos(t), math.sin(t)
        return [s * c, -s * sn, -s * sn * flip, -s * c * flip, tx, ty]

    B = np.array(boundary)
    L = np.array(outer)
    area_img = silhouette.sum()
    area_osm = 0.5 * abs(sum(B[i, 0] * B[(i + 1) % len(B), 1] - B[(i + 1) % len(B), 0] * B[i, 1] for i in range(len(B))))
    s0 = math.sqrt(area_img / area_osm)
    ys, xs = np.nonzero(silhouette)
    ly, lx = np.nonzero(lakes)
    best = None
    candidates = []
    for flip in (1, -1) if args.mirror else (1,):
        for deg in range(0, 360, 5):
            # Align either the park centroids or the lake centroids; keep the better.
            for src, dst in (((B[:, 0].mean(), B[:, 1].mean()), (xs.mean(), ys.mean())), ((L[:, 0].mean(), L[:, 1].mean()), (lx.mean(), ly.mean()))):
                A = similarity(s0, deg, 0, 0, flip)
                px, py = apply(src, A)
                A[4], A[5] = dst[0] - px, dst[1] - py
                sc = score(A)
                candidates.append((sc, deg, flip))
                if best is None or sc[0] > best[0][0]:
                    best = (sc, deg, flip, A)
    for sc, deg, flip in sorted(candidates, key=lambda c: -c[0][0])[:4]:
        print(f"coarse rot {deg:3d} flip {flip:2d}: park IoU {sc[1]:.3f} lake IoU {sc[2]:.3f} water {sc[3]:.3f}")
    sim_scores, deg0, flip0, A = best
    current = (score(A)[0], A)
    rng = random.Random(5)
    for it in range(5000):
        f = 0.3 if it > 3000 else 1.0
        cand = [
            A[0] * (1 + rng.gauss(0, 0.01 * f)),
            A[1] + rng.gauss(0, 0.01 * f) * abs(A[0]),
            A[2] + rng.gauss(0, 0.01 * f) * abs(A[0]),
            A[3] * (1 + rng.gauss(0, 0.01 * f)),
            A[4] + rng.gauss(0, 1.2 * f),
            A[5] + rng.gauss(0, 1.2 * f),
        ]
        if (v := score(cand)[0]) > current[0]:
            current, A = (v, cand), cand
    final = score(A)
    a, b, c, d, tx, ty = [v * k for v in A]
    det = a * d - b * c

    def pixel_to_lonlat(X, Y):
        x = (d * (X - tx) - b * (Y - ty)) / det
        y = (-c * (X - tx) + a * (Y - ty)) / det
        return [round(LON0 + x / KX, 7), round(LAT0 + y / KY, 7)]

    result = {
        "status": "provisional",
        "method": "affine fit of the OSM park boundary + lake to the picture's outline and painted lakes",
        "image": args.image.name,
        "imageSizePx": [width, height],
        "rotationDegreesCoarse": deg0,
        "mirrored": flip0 == -1,
        "metresPerPixel": [round(1 / math.hypot(a, c), 3), round(1 / math.hypot(b, d), 3)],
        "parkOutlineIoU": round(final[1], 3),
        "lakeIoU": round(final[2], 3),
        "osmFootpathSamplesOnPaintedWater": round(final[3], 3),
        "osmFootpathSamplesInsidePark": round(final[4], 3),
        "similarityOnlyBaseline": {"parkOutlineIoU": round(sim_scores[1], 3), "lakeIoU": round(sim_scores[2], 3)},
        "note": "Outline fit of a stylized picture; the outline is not surveyed. Verify on site before trusting.",
        "corners": [
            pixel_to_lonlat(0, 0),
            pixel_to_lonlat(width, 0),
            pixel_to_lonlat(width, height),
            pixel_to_lonlat(0, height),
        ],
    }
    args.out.write_text(json.dumps(result, indent=2) + "\n")
    print(json.dumps({key: v for key, v in result.items() if key != "corners"}, indent=2))


if __name__ == "__main__":
    main()
