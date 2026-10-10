#!/usr/bin/env python3
"""Copy the positions computed by build_graph.py into data/pois/damsen-pois.json.

    python3 data/walkways-new/build_graph.py && python3 data/walkways-new/sync_pois.py

damsen-pois.json keeps names/categories (authored); position, pin pixel and pin colour of each
numbered place come from the build (so they follow the georeference and its control points).
"""
import json
from pathlib import Path

HERE = Path(__file__).resolve().parent
target = HERE.parents[1] / "data/pois/damsen-pois.json"
data = json.loads(target.read_text())
built = {p["number"]: p for p in json.loads((HERE / "damsen-pois-new.json").read_text())["pois"] if p["number"]}
for place in data["pois"]:
    b = built[place["number"]]
    place["pixel"] = {"x": b["pinPx"][0], "y": b["pinPx"][1]}
    place["latitude"], place["longitude"], place["pin"] = b["latitude"], b["longitude"], b["color"]
target.write_text(json.dumps(data, ensure_ascii=False, indent=2) + "\n")
print(f"updated {len(data['pois'])} places")
