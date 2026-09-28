#!/usr/bin/env python3
from __future__ import annotations

import json
from pathlib import Path


ROOT = Path(__file__).resolve().parent


def load(name: str) -> dict:
    return json.loads((ROOT / name).read_text(encoding="utf-8"))


def main() -> None:
    pois = load("pois.geojson")
    entrances = load("entrances.geojson")
    nodes = load("walk_nodes.geojson")
    edges = load("walk_edges.geojson")
    assert len(pois["features"]) == 24
    assert len(entrances["features"]) == 24
    assert len(nodes["features"]) == 25
    assert len(edges["features"]) == 40
    for collection in (pois, entrances, nodes, edges):
        assert collection["research_only"] is True
        assert collection["navigation_use"] == "prohibited_until_field_verified"
    poi_ids = {feature["id"] for feature in pois["features"]}
    node_refs = {
        feature["properties"]["external_id"] for feature in nodes["features"]
    }
    node_coordinates = {
        feature["properties"]["external_id"]: feature["geometry"]["coordinates"]
        for feature in nodes["features"]
    }
    adjacency = {node_ref: set() for node_ref in node_refs}
    assert len(poi_ids) == 24
    for feature in pois["features"]:
        properties = feature["properties"]
        assert properties["status"] == "draft"
        assert properties["coordinate_accuracy"] == "synthetic_approximation"
        assert properties["field_verified"] is False
        assert properties["source_url"].startswith("https://damsenpark.vn/")
    for feature in entrances["features"]:
        assert feature["properties"]["poi_id"] in poi_ids
        assert feature["properties"]["graph_node_ref"] in node_refs
    for feature in edges["features"]:
        properties = feature["properties"]
        assert properties["source"] in node_refs
        assert properties["target"] in node_refs
        assert properties["status"] == "research_only"
        assert properties["field_verified"] is False
        assert properties["length_m"] > 0
        coordinates = feature["geometry"]["coordinates"]
        assert coordinates[0] == node_coordinates[properties["source"]]
        assert coordinates[-1] == node_coordinates[properties["target"]]
        adjacency[properties["source"]].add(properties["target"])
        adjacency[properties["target"]].add(properties["source"])
    visited = set()
    pending = [next(iter(node_refs))]
    while pending:
        current = pending.pop()
        if current in visited:
            continue
        visited.add(current)
        pending.extend(adjacency[current] - visited)
    assert visited == node_refs
    print("PASS: research dataset is isolated, draft-only and explicitly non-navigable.")


if __name__ == "__main__":
    main()
