#!/usr/bin/env python3
"""Validate data/pois/damsen-pois.json before it is imported.

    python3 data/pois/validate.py
"""

import json
import re
import sys
from pathlib import Path

HERE = Path(__file__).resolve().parent
CATEGORIES = {
    "gate", "ride", "thrill_ride", "children", "interactive", "show", "exhibit",
    "garden", "indoor", "landmark", "food", "restroom", "parking", "first_aid", "security",
}
PIN_COLORS = {"white", "blue", "purple", "pink", "red", "yellow"}  # legend of the official map
# Generous box around the park (OSM boundary 106.6352–106.6418 E, 10.7597–10.769 N).
LAT_RANGE = (10.7585, 10.7700)
LON_RANGE = (106.6340, 106.6430)


def main() -> int:
    data = json.loads((HERE / "damsen-pois.json").read_text(encoding="utf-8"))
    errors: list[str] = []
    pois = data["pois"]
    numbers = [p["number"] for p in pois]
    if sorted(numbers) != list(range(1, len(numbers) + 1)):
        errors.append("numbers must be 1..N without gaps or duplicates")
    slugs = [p["slug"] for p in pois]
    if len(set(slugs)) != len(slugs):
        errors.append("duplicate slugs")
    for p in pois:
        label = f"#{p['number']}"
        if not re.fullmatch(r"[a-z][a-z0-9-]{0,99}", p["slug"]):
            errors.append(f"{label}: bad slug {p['slug']!r}")
        if p["category"] not in CATEGORIES:
            errors.append(f"{label}: unknown category {p['category']!r}")
        if p.get("pin") not in PIN_COLORS:
            errors.append(f"{label}: pin must be one of {sorted(PIN_COLORS)}")
        for key in ("nameVi", "nameEn"):
            if not p[key].strip() or len(p[key]) > 200:
                errors.append(f"{label}: bad {key}")
        if not (LAT_RANGE[0] <= p["latitude"] <= LAT_RANGE[1] and LON_RANGE[0] <= p["longitude"] <= LON_RANGE[1]):
            errors.append(f"{label}: coordinates outside the park area")
    coords = [(p["latitude"], p["longitude"]) for p in pois]
    if len(set(coords)) != len(coords):
        errors.append("two places share the same coordinates")
    new_places = json.loads((HERE / "new-places.json").read_text(encoding="utf-8"))["places"]
    for p in new_places:
        label = p.get("slug", "?")
        if not re.fullmatch(r"new-[a-z0-9-]{1,95}", p.get("slug", "")) or p["slug"] in slugs:
            errors.append(f"{label}: slug must be unique and start with new-")
        if p["category"] not in CATEGORIES or p.get("pin") not in PIN_COLORS:
            errors.append(f"{label}: bad category or pin colour")
        if "pixel" in p:
            if not (0 <= p["pixel"]["x"] <= 2048 and 0 <= p["pixel"]["y"] <= 1315):
                errors.append(f"{label}: pixel outside the 2048x1315 map")
        elif not (LAT_RANGE[0] <= p.get("latitude", 0) <= LAT_RANGE[1] and LON_RANGE[0] <= p.get("longitude", 0) <= LON_RANGE[1]):
            errors.append(f"{label}: needs a pixel or coordinates inside the park area")
    amenities = json.loads((HERE / "amenities.json").read_text(encoding="utf-8"))["places"]
    kinds = {"food", "wc", "wc-access", "parking", "first-aid", "security"}
    for p in amenities:
        label = p.get("slug", "?")
        if not re.fullmatch(r"svc-[a-z0-9-]{1,95}", p.get("slug", "")) or p["slug"] in slugs:
            errors.append(f"{label}: slug must be unique and start with svc-")
        if p["kind"] not in kinds or p["category"] not in CATEGORIES or not p["slug"].startswith(f"svc-{p['kind']}"):
            errors.append(f"{label}: bad kind/category")
        if not (0 <= p["pixel"]["x"] <= 2048 and 0 <= p["pixel"]["y"] <= 1315):
            errors.append(f"{label}: pixel outside the 2048x1315 map")
    gates = [p["number"] for p in pois if p["category"] == "gate"]
    if len(gates) < 1:
        errors.append("expected at least one gate")
    for message in errors:
        print(f"ERROR: {message}")
    if errors:
        print(f"FAIL: {len(errors)} problem(s)")
        return 1
    print(f"PASS: {len(pois)} places + {len(new_places)} new + {len(amenities)} service points, {len(gates)} gates, all inside the park area")
    return 0


if __name__ == "__main__":
    sys.exit(main())
