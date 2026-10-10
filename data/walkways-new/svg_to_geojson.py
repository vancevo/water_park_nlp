#!/usr/bin/env python3
"""Convert the redrawn footpath SVG (gate at the bottom) to WGS84 GeoJSON.

    python3 data/walkways-new/svg_to_geojson.py

SVG px -> px of the old illustrated picture (apps/visitor-web/public/maps/damsen-map.jpg):
an affine fitted (trimmed ICP) onto the cream paths painted in that picture, i.e. the SVG is
the picture turned ~90 deg (gate right -> gate bottom) at ~1.27 SVG px per picture px.
Picture px -> lon/lat: that picture's georeference (old-picture.georef.json, fitted to OSM).
Estimate, not surveyed: expect ~3-4 m error; verify on site.
"""
import json
import re
from pathlib import Path

import numpy as np

HERE = Path(__file__).resolve().parent
GEOREF = HERE / "old-picture.georef.json"  # corners of the earlier illustrated picture (fitted to OSM)
# rows: [x_old, y_old] coefficients for svg x, svg y, then the offset
SVG_TO_PICTURE = np.array(
    [[-0.0166359084, -0.785424762], [0.796617740, -0.0433977113], [35.6627453, 1441.32281]]
)
STREET_IDS = {"north-street"}  # outer public street, not a park footpath


def parse(svg):
    paths = []
    for m in re.finditer(r'<path[^>]*?\sid="([^"]*)"[^>]*?\sd="([^"]+)"', svg):
        toks = re.findall(r"[MLCZ]|-?\d+\.?\d*", m.group(2))
        i, pts, cur, start, cmd = 0, [], None, None, None
        while i < len(toks):
            if toks[i] in "MLCZ":
                cmd = toks[i]
                i += 1
            if cmd == "Z":
                pts.append(start)
                continue
            nums = {"M": 2, "L": 2, "C": 6}[cmd]
            v = [float(t) for t in toks[i : i + nums]]
            i += nums
            if cmd in "ML":
                cur = np.array(v)
                pts.append(cur)
                if cmd == "M":
                    start, cmd = cur, "L"
            else:
                p0, p1, p2, p3 = cur, *np.array(v).reshape(3, 2)
                for t in np.linspace(0, 1, 13)[1:]:
                    pts.append((1 - t) ** 3 * p0 + 3 * (1 - t) ** 2 * t * p1 + 3 * (1 - t) * t**2 * p2 + t**3 * p3)
                cur = p3
        paths.append((m.group(1), np.array(pts)))
    return paths


def main():
    georef = json.loads(GEOREF.read_text())
    w, h = georef["imageSizePx"]
    tl, tr, _br, bl = (np.array(c) for c in georef["corners"])

    def to_lonlat(px):
        u, v = px[:, 0] / w, px[:, 1] / h
        return tl + u[:, None] * (tr - tl) + v[:, None] * (bl - tl)

    features = []
    for pid, pts in parse((HERE / "dam-sen-line-duong.svg").read_text()):
        picture = np.c_[pts, np.ones(len(pts))] @ SVG_TO_PICTURE
        coords = [[round(float(a), 7), round(float(b), 7)] for a, b in to_lonlat(picture)]
        features.append(
            {
                "type": "Feature",
                "properties": {"id": pid, "kind": "street" if pid in STREET_IDS else "footpath"},
                "geometry": {"type": "LineString", "coordinates": coords},
            }
        )
    out = {
        "type": "FeatureCollection",
        "name": "damsen-walkways-new",
        "note": "Redrawn paths (gate at the bottom) georeferenced via the illustrated picture. Estimate (~3-4 m), not surveyed.",
        "features": features,
    }
    (HERE / "damsen-walkways-new.geojson").write_text(json.dumps(out, ensure_ascii=False))
    print(f"{len(features)} lines -> damsen-walkways-new.geojson")


if __name__ == "__main__":
    main()
