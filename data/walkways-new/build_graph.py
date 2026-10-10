#!/usr/bin/env python3
"""Build the routable walkway graph from the redrawn SVG footpaths and the POI pins.

    python3 data/walkways-new/build_graph.py

Reads  dam-sen-line-duong.svg (footpaths drawn on the official map) and pins.json.
Writes graph.json     nodes/edges in lon/lat (+ SVG px) ready for scripts/import-redrawn-walkways.mjs
       damsen-walkways.geojson  the noded edges (the layer the maps draw)
       damsen-pois-new.json     one entrance node per numbered pin, snapped onto the graph

Steps: sample the curves, split every path where it crosses another, pull loose ends that
stop within SNAP_PX of another path onto it, then cut the paths into edges between
junctions/ends. Pin tips are projected onto the nearest edge and become `poi_entrance` nodes.
"""
import json
import math
import sys
from pathlib import Path

import numpy as np

HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(HERE))
from svg_to_geojson import GEOREF, SVG_TO_PICTURE, STREET_IDS, parse  # noqa: E402

SNAP_PX = 9.0  # SVG px (~5 m): a path end this close to another path is joined to it
NODE_SPACING_PX = 25.0  # ~15 m between nodes along an edge
MERGE_PX = 2.0  # nodes closer than this are the same node
JOIN_PX = 70.0  # isolated pieces are joined to the main network when closer than this
LON0, LAT0 = 106.6385, 10.764
KX, KY = math.cos(math.radians(LAT0)) * 111320, 110574


def seg_intersections(a, b):
    """Proper intersections of polyline a with polyline b: [(i, t, j, u, point)]."""
    out = []
    for i in range(len(a) - 1):
        p, r = a[i], a[i + 1] - a[i]
        for j in range(len(b) - 1):
            q, s = b[j], b[j + 1] - b[j]
            den = r[0] * s[1] - r[1] * s[0]
            if abs(den) < 1e-9:
                continue
            t = ((q[0] - p[0]) * s[1] - (q[1] - p[1]) * s[0]) / den
            u = ((q[0] - p[0]) * r[1] - (q[1] - p[1]) * r[0]) / den
            if 1e-6 < t < 1 - 1e-6 and 1e-6 < u < 1 - 1e-6:
                out.append((i, t, j, u, p + t * r))
    return out


def project(pt, line):
    """Nearest point on a polyline: (distance, segment index, t, point)."""
    best = (1e18, 0, 0.0, line[0])
    for i in range(len(line) - 1):
        a, d = line[i], line[i + 1] - line[i]
        L2 = float(d @ d)
        t = 0.0 if L2 == 0 else min(1.0, max(0.0, float((pt - a) @ d) / L2))
        q = a + t * d
        dist = float(np.linalg.norm(pt - q))
        if dist < best[0]:
            best = (dist, i, t, q)
    return best


def insert_point(line, seg, point):
    """Insert `point` into `line` after vertex `seg` unless it is already (almost) a vertex."""
    for k in (seg, seg + 1):
        if np.linalg.norm(line[k] - point) < MERGE_PX:
            return line, k
    return np.vstack([line[: seg + 1], point, line[seg + 1 :]]), seg + 1


def main():
    paths = [(i, p.astype(float)) for i, p in parse((HERE / "dam-sen-line-duong.svg").read_text()) if i not in STREET_IDS]
    ids = [i for i, _ in paths]
    lines = [p for _, p in paths]

    # 1. split at crossings between different paths
    cuts = {k: [] for k in range(len(lines))}  # path -> [(seg index, point)]
    for a in range(len(lines)):
        for b in range(a + 1, len(lines)):
            for i, _t, j, _u, pt in seg_intersections(lines[a], lines[b]):
                cuts[a].append((i, pt))
                cuts[b].append((j, pt))
    # 2. loose ends close to another path are projected onto it (and the path is cut there)
    for a, line in enumerate(lines):
        for end in (0, len(line) - 1):
            best = None
            for b, other in enumerate(lines):
                if b == a:
                    continue
                dist, seg, _t, q = project(line[end], other)
                if dist <= SNAP_PX and (best is None or dist < best[0]):
                    best = (dist, b, seg, q)
            if best:
                _d, b, seg, q = best
                lines[a] = lines[a].copy()
                lines[a][end] = q
                cuts[b].append((seg, q))
    # apply cuts (largest segment index first so earlier indices stay valid)
    for k in range(len(lines)):
        for seg, pt in sorted(cuts[k], key=lambda c: (-c[0], -float(np.linalg.norm(c[1] - lines[k][c[0]])))):
            lines[k], _ = insert_point(lines[k], seg, pt)

    # 3. node registry; split each path at junction vertices (vertices shared by 2+ paths, or ends)
    nodes = []  # px positions

    def node_at(pt):
        for n, q in enumerate(nodes):
            if np.linalg.norm(q - pt) < MERGE_PX:
                return n
        nodes.append(np.array(pt, float))
        return len(nodes) - 1

    vertex_nodes = [[node_at(v) for v in line] for line in lines]
    use = {}
    for vn in vertex_nodes:
        for n in set(vn):
            use[n] = use.get(n, 0) + 1
    edges = []  # (a, b, polyline px, path id)
    for k, line in enumerate(lines):
        vn = vertex_nodes[k]
        start = 0
        for v in range(1, len(line)):
            is_cut = v == len(line) - 1 or use[vn[v]] > 1
            if is_cut:
                if vn[start] != vn[v]:
                    poly = line[start : v + 1].copy()
                    poly[0], poly[-1] = nodes[vn[start]], nodes[vn[v]]
                    edges.append((vn[start], vn[v], poly, ids[k]))
                start = v

    # 4. connect isolated pieces to the main network (shortest straight gap < JOIN_PX)
    def components():
        parent = list(range(len(nodes)))
        in_use = {n for a, b, _, _ in edges for n in (a, b)}

        def find(x):
            while parent[x] != x:
                parent[x] = parent[parent[x]]
                x = parent[x]
            return x

        for a, b, _, _ in edges:
            parent[find(a)] = find(b)
        comp = {}
        for n in sorted(in_use):
            comp.setdefault(find(n), []).append(n)
        return sorted(comp.values(), key=len, reverse=True)

    joined = []
    while True:
        comps = components()
        if len(comps) == 1:
            break
        main, rest = set(comps[0]), comps[1]
        best = None
        for n in rest:
            for e_a, e_b, poly, _pid in list(edges):
                if e_a not in main or e_b not in main:
                    continue
                dist, seg, _t, q = project(nodes[n], poly)
                if best is None or dist < best[0]:
                    best = (dist, n, e_a, e_b, poly, seg, q)
        if best is None or best[0] > JOIN_PX:
            print(f"left unconnected: {len(rest)} nodes (gap {best[0] if best else '-'} px)")
            break
        dist, n, e_a, e_b, poly, seg, q = best
        edges = [e for e in edges if not (e[0] == e_a and e[1] == e_b and e[2] is poly)]
        m = node_at(q)
        left = np.vstack([poly[: seg + 1], q])
        right = np.vstack([q, poly[seg + 1 :]])
        edges.append((e_a, m, left, "split"))
        edges.append((m, e_b, right, "split"))
        edges.append((m, n, np.vstack([q, nodes[n]]), "connector"))
        joined.append(round(dist, 1))
        print(f"joined an isolated piece of {len(rest)} nodes with a connector of {round(dist, 1)} px at {np.round(nodes[n])}")

    # pixel -> lon/lat (see svg_to_geojson.py)
    g = json.loads(GEOREF.read_text())
    w, h = g["imageSizePx"]
    tl, tr, _br, bl = (np.array(c) for c in g["corners"])

    def ll_fitted(px):  # picture px -> lon/lat as fitted to the OSM footpaths
        px = np.atleast_2d(px)
        pic = np.c_[px, np.ones(len(px))] @ SVG_TO_PICTURE
        return tl + (pic[:, 0:1] / w) * (tr - tl) + (pic[:, 1:2] / h) * (bl - tl)

    def to_m(lonlat):
        lonlat = np.atleast_2d(lonlat)
        return np.c_[(lonlat[:, 0] - LON0) * KX, (lonlat[:, 1] - LAT0) * KY]

    def to_lonlat(m):
        return np.c_[m[:, 0] / KX + LON0, m[:, 1] / KY + LAT0]

    # Control points (control-points.json): spots whose real lon/lat is known and whose pixel on the
    # picture was read off. 1 point = shift, 2 = shift + rotate + scale, 3+ = full affine.
    cps = json.loads((HERE / "control-points.json").read_text())["points"]
    cp_src = to_m(ll_fitted(np.array([c["pixel"] for c in cps], float)))
    cp_dst = to_m(np.array([[c["lon"], c["lat"]] for c in cps], float))
    if len(cps) == 1:
        correction = lambda m: m + (cp_dst[0] - cp_src[0])
    elif len(cps) == 2:
        z = lambda a: a[:, 0] + 1j * a[:, 1]
        k = (z(cp_dst)[1] - z(cp_dst)[0]) / (z(cp_src)[1] - z(cp_src)[0])
        t = z(cp_dst)[0] - k * z(cp_src)[0]
        correction = lambda m: np.c_[(k * z(m) + t).real, (k * z(m) + t).imag]
    else:
        aff = np.linalg.lstsq(np.c_[cp_src, np.ones(len(cp_src))], cp_dst, rcond=None)[0]
        correction = lambda m: np.c_[m, np.ones(len(m))] @ aff

    def ll(px):  # picture px -> lon/lat, corrected so every control point lands on its real coordinate
        return to_lonlat(correction(to_m(ll_fitted(px))))

    # 5. POI entrances: project each numbered pin onto the nearest edge and split it there.
    # A place with sub-pins (11 -> 11.1..11.4) is drawn at the centre of those sub-pins.
    pins = json.loads((HERE / "pins.json").read_text())["pins"]
    for pin in pins:
        subs = [q for q in pins if q["number"].startswith(pin["number"] + ".")]
        if subs:
            pin["tipPx"] = [round(float(np.mean([q["tipPx"][0] for q in subs])), 1), round(float(np.mean([q["tipPx"][1] for q in subs])), 1)]
    # places added after the numbered map (data/pois/new-places.json) get an entrance the same way
    pois_dir = HERE.parents[0] / "pois"
    new_places = json.loads((pois_dir / "new-places.json").read_text())["places"]
    new_places += json.loads((pois_dir / "amenities.json").read_text())["places"]  # no pin colour
    targets = [{"number": p["number"], "slug": None, "color": p["color"], "tipPx": p["tipPx"]} for p in pins if "." not in p["number"]]
    # a new place may be given as lat/lon: invert the (affine) px -> lon/lat map to find its pixel
    grid = np.array([[x, y] for x in range(0, 2049, 256) for y in range(0, 1316, 263)], float)
    px_to_ll = np.linalg.lstsq(np.c_[grid, np.ones(len(grid))], ll(grid), rcond=None)[0]

    def pixel_of(lon, lat):
        A = px_to_ll[:2].T  # lon/lat = A @ px + b
        return np.linalg.solve(A, np.array([lon, lat]) - px_to_ll[2])

    targets += [
        {
            "number": None,
            "slug": p["slug"],
            "color": p.get("pin"),
            "tipPx": [p["pixel"]["x"], p["pixel"]["y"]] if "pixel" in p else [round(float(v), 1) for v in pixel_of(p["longitude"], p["latitude"])],
            "given": (p["longitude"], p["latitude"]) if "latitude" in p else None,
        }
        for p in new_places
    ]
    entrances = []
    for pin in targets:
        pt = np.array(pin["tipPx"], float)
        best = None
        for ei, (_a, _b, poly, _pid) in enumerate(edges):
            dist, seg, _t, q = project(pt, poly)
            if best is None or dist < best[0]:
                best = (dist, ei, seg, q)
        dist, ei, seg, q = best
        a, b, poly, pid = edges[ei]
        in_use = {x for ea, eb, _, _ in edges for x in (ea, eb)}
        existing = next((n for n in in_use if np.linalg.norm(nodes[n] - q) < MERGE_PX), None)
        if existing is None:
            n = node_at(q)
            left, right = np.vstack([poly[: seg + 1], q]), np.vstack([q, poly[seg + 1 :]])
            edges[ei] = (a, n, left, pid)
            edges.append((n, b, right, pid))
        else:
            n = existing
        entrances.append({"target": pin, "node": n, "distPx": round(dist, 1)})

    # 5b. a node about every NODE_SPACING_PX along long edges, so a new place can snap to the path
    # (and the admin form's nearest-node snapping stays within a few metres of it)
    dense = []
    for a, b, poly, pid in edges:
        start, run = 0, 0.0
        for v in range(1, len(poly)):
            run += float(np.linalg.norm(poly[v] - poly[v - 1]))
            tail = float(sum(np.linalg.norm(poly[k + 1] - poly[k]) for k in range(v, len(poly) - 1)))
            if run >= NODE_SPACING_PX and tail >= NODE_SPACING_PX / 2 and v < len(poly) - 1:
                m = node_at(poly[v])
                dense.append((a, m, poly[start : v + 1].copy(), pid))
                a, start, run = m, v, 0.0
        dense.append((a, b, poly[start:].copy(), pid))
    edges = dense

    # drop vertex nodes that no edge ended up using, renumber the rest
    keep = sorted({n for a, b, _, _ in edges for n in (a, b)})
    renum = {old: new for new, old in enumerate(keep)}
    nodes = [nodes[n] for n in keep]
    edges = [(renum[a], renum[b], poly, pid) for a, b, poly, pid in edges]
    for e in entrances:
        e["node"] = renum[e["node"]]

    # 6. to lon/lat
    def metres(lonlat):
        return np.c_[(lonlat[:, 0] - LON0) * KX, (lonlat[:, 1] - LAT0) * KY]

    node_ll = ll(np.array(nodes))
    kinds = {e["node"]: "poi_entrance" for e in entrances}
    out_nodes = [
        {
            "id": n + 1,
            "externalId": f"nw-{n + 1}",
            "px": [round(float(p[0]), 1), round(float(p[1]), 1)],
            "lon": round(float(node_ll[n][0]), 7),
            "lat": round(float(node_ll[n][1]), 7),
            "kind": kinds.get(n, "junction"),
        }
        for n, p in enumerate(nodes)
    ]
    out_edges, feats = [], []
    for k, (a, b, poly, pid) in enumerate(edges):
        coords = ll(poly)
        length = float(np.linalg.norm(np.diff(metres(coords), axis=0), axis=1).sum())
        if length <= 0 or a == b:
            continue
        lonlat = [[round(float(x), 7), round(float(y), 7)] for x, y in coords]
        out_edges.append(
            {"id": k + 1, "externalId": f"nw-e{k + 1}", "source": a + 1, "target": b + 1, "lengthM": round(length, 2), "path": pid, "coordinates": lonlat}
        )
        feats.append(
            {"type": "Feature", "properties": {"id": f"nw-e{k + 1}", "path": pid, "lengthM": round(length, 2)}, "geometry": {"type": "LineString", "coordinates": lonlat}}
        )
    (HERE / "graph.json").write_text(json.dumps({"source": "redrawn_2026-10-10", "nodes": out_nodes, "edges": out_edges}, ensure_ascii=False))
    (HERE / "damsen-walkways.geojson").write_text(
        json.dumps(
            {
                "type": "FeatureCollection",
                "name": "damsen-walkways",
                "note": "Footpaths redrawn on the official map (gate at the bottom), georeferenced via the illustrated picture. Estimate (~3-8 m), not surveyed.",
                "features": feats,
            },
            ensure_ascii=False,
        )
    )
    ent_out = []
    for e in entrances:
        n = out_nodes[e["node"]]
        pin = e["target"]
        pl = np.array(pin["given"]) if pin.get("given") else ll(np.array(pin["tipPx"]))[0]
        ent_out.append(
            {
                "number": int(pin["number"]) if pin["number"] is not None else None,
                "slug": pin["slug"],
                "color": pin["color"],
                "pinPx": pin["tipPx"],
                "latitude": round(float(pl[1]), 7),
                "longitude": round(float(pl[0]), 7),
                "entranceNode": n["externalId"],
                "entranceLatitude": n["lat"],
                "entranceLongitude": n["lon"],
                "entranceDistancePx": e["distPx"],
            }
        )
    (HERE / "damsen-pois-new.json").write_text(json.dumps({"pois": ent_out}, ensure_ascii=False, indent=1))
    # georeference of the background picture (corners TL, TR, BR, BL) + the bearing that puts it upright
    W, H = 2048, 1315
    corners = ll(np.array([[0, 0], [W, 0], [W, H], [0, H]], float))
    up = metres(corners[[0]]) - metres(corners[[3]])  # bottom-left -> top-left, metres (east, north)
    bearing = (math.degrees(math.atan2(up[0][0], up[0][1])) + 360) % 360
    centre = corners.mean(axis=0)
    (HERE / "damsen-map.georef.json").write_text(
        json.dumps(
            {
                "status": "traced-and-fitted",
                "method": "svg_to_geojson.py: footpaths traced on this picture, fitted (trimmed ICP) onto the paths painted in the earlier illustrated picture, whose corners were fitted to the OSM footpaths",
                "image": "damsen-map.jpg",
                "imageSizePx": [W, H],
                "bearingDegrees": round(bearing, 2),
                "centre": [round(float(centre[0]), 7), round(float(centre[1]), 7)],
                "note": "Estimate, not surveyed (~3-8 m). Rotate the map to bearingDegrees to see the picture upright (gate 1 at the bottom).",
                "corners": [[round(float(c[0]), 7), round(float(c[1]), 7)] for c in corners],
            },
            indent=2,
        )
    )
    print("bearing", round(bearing, 1), "centre", centre)
    # sub-places (data/pois/sub-places.json) with the position/colour of those that have a pin
    authored = json.loads((HERE.parents[0] / "pois" / "sub-places.json").read_text())["places"]
    by_pin = {p["number"]: p for p in pins}
    sub_out = {}
    for parent, children in authored.items():
        items = []
        for child in children:
            item = {"nameVi": child["nameVi"], "nameEn": child["nameEn"]}
            if "pin" in child:
                pin = by_pin[child["pin"]]
                pl = ll(np.array(pin["tipPx"]))[0]
                item.update({"pin": child["pin"], "color": pin["color"], "latitude": round(float(pl[1]), 7), "longitude": round(float(pl[0]), 7)})
            if child.get("needsName"):
                item["needsName"] = True
            items.append(item)
        sub_out[parent] = items
    (HERE / "damsen-sub-places.json").write_text(json.dumps({"places": sub_out}, ensure_ascii=False, indent=1))
    far = sorted((e for e in ent_out if e["entranceDistancePx"] > 30), key=lambda e: -e["entranceDistancePx"])
    comps = components()
    print(f"{len(out_nodes)} nodes, {len(out_edges)} edges, {len(comps)} component(s), total {sum(e['lengthM'] for e in out_edges):.0f} m")
    print("entrances > 30 px (~18 m) from a path:", [(e["number"] or e["slug"], e["entranceDistancePx"]) for e in far])


if __name__ == "__main__":
    main()
