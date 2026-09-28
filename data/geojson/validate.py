#!/usr/bin/env python3
"""Validate the authoritative synthetic POI/walkway fixture with stdlib only."""

from __future__ import annotations

import json
import math
import sys
from collections import defaultdict, deque
from pathlib import Path
from typing import Any

ROOT = Path(__file__).resolve().parent
FILES = ("pois.geojson", "entrances.geojson", "walkway_nodes.geojson", "walkway_edges.geojson")
ENDPOINT_TOLERANCE_M = 0.25
ENTRANCE_TOLERANCE_M = 15.0
COST_TOLERANCE_M = 0.5
POI_IDS = {f"00000000-0000-4000-8000-00000000010{index}" for index in range(1, 6)}
ENTRANCE_IDS = {f"00000000-0000-4000-8000-00000000020{index}" for index in range(1, 6)}
NODE_POSITIONS = {
    "N1": [106.63470, 10.76700], "N2": [106.63500, 10.76700],
    "N3": [106.63535, 10.76700], "N4": [106.63570, 10.76700],
    "N5": [106.63500, 10.76730], "N6": [106.63535, 10.76730],
    "N7": [106.63570, 10.76730],
}
EDGE_ENDPOINTS = {
    "N1-N2": ("N1", "N2"), "N2-N3": ("N2", "N3"),
    "N3-N4": ("N3", "N4"), "N2-N5": ("N2", "N5"),
    "N3-N6": ("N3", "N6"), "N4-N7": ("N4", "N7"),
    "N5-N6": ("N5", "N6"), "N6-N7": ("N6", "N7"),
}
POI_ENTRANCE_NODES = {
    "00000000-0000-4000-8000-000000000101": ("00000000-0000-4000-8000-000000000201", "N2"),
    "00000000-0000-4000-8000-000000000102": ("00000000-0000-4000-8000-000000000202", "N3"),
    "00000000-0000-4000-8000-000000000103": ("00000000-0000-4000-8000-000000000203", "N4"),
    "00000000-0000-4000-8000-000000000104": ("00000000-0000-4000-8000-000000000204", "N6"),
    "00000000-0000-4000-8000-000000000105": ("00000000-0000-4000-8000-000000000205", "N7"),
}


class Validation:
    def __init__(self) -> None:
        self.errors: list[str] = []

    def check(self, condition: bool, message: str) -> None:
        if not condition:
            self.errors.append(message)


def load_json(path: Path, validation: Validation) -> Any:
    try:
        with path.open(encoding="utf-8") as handle:
            return json.load(handle)
    except (OSError, json.JSONDecodeError) as error:
        validation.errors.append(f"{path.name}: cannot read valid JSON: {error}")
        return {}


def haversine_m(a: list[float], b: list[float]) -> float:
    lon1, lat1, lon2, lat2 = map(math.radians, (*a, *b))
    dlon, dlat = lon2 - lon1, lat2 - lat1
    value = math.sin(dlat / 2) ** 2 + math.cos(lat1) * math.cos(lat2) * math.sin(dlon / 2) ** 2
    return 6_371_008.8 * 2 * math.atan2(math.sqrt(value), math.sqrt(1 - value))


def validate_position(position: Any, label: str, bbox: list[float], validation: Validation) -> bool:
    valid = isinstance(position, list) and len(position) == 2 and all(
        isinstance(value, (int, float)) and not isinstance(value, bool) and math.isfinite(value) for value in position
    )
    validation.check(valid, f"{label}: coordinate must be two finite numbers [longitude, latitude]")
    if not valid:
        return False
    lon, lat = position
    validation.check(-180 <= lon <= 180 and -90 <= lat <= 90, f"{label}: coordinate is outside WGS84 range")
    validation.check(bbox[0] <= lon <= bbox[2] and bbox[1] <= lat <= bbox[3], f"{label}: coordinate is outside metadata bbox")
    return True


def feature_map(document: Any, filename: str, geometry_type: str, bbox: list[float], validation: Validation) -> dict[str, dict[str, Any]]:
    validation.check(isinstance(document, dict) and document.get("type") == "FeatureCollection", f"{filename}: expected FeatureCollection")
    items = document.get("features", []) if isinstance(document, dict) else []
    validation.check(isinstance(items, list), f"{filename}: features must be an array")
    result: dict[str, dict[str, Any]] = {}
    for index, feature in enumerate(items if isinstance(items, list) else []):
        label = f"{filename} feature[{index}]"
        feature_id = feature.get("id") if isinstance(feature, dict) else None
        validation.check(isinstance(feature_id, str) and bool(feature_id), f"{label}: non-empty string id required")
        if isinstance(feature_id, str):
            validation.check(feature_id not in result, f"{filename}: duplicate id {feature_id}")
            result[feature_id] = feature
        geometry = feature.get("geometry", {}) if isinstance(feature, dict) else {}
        validation.check(geometry.get("type") == geometry_type, f"{label}: expected {geometry_type} geometry")
        coordinates = geometry.get("coordinates")
        positions = [coordinates] if geometry_type == "Point" else coordinates
        validation.check(isinstance(positions, list) and (geometry_type == "Point" or len(positions) >= 2), f"{label}: invalid coordinate array")
        if isinstance(positions, list):
            for point_index, position in enumerate(positions):
                validate_position(position, f"{label} point[{point_index}]", bbox, validation)
    return result


def reachable(nodes: set[str], edges: dict[str, dict[str, Any]], *, step_free: bool = False, closed: set[str] | None = None) -> set[str]:
    adjacency: dict[str, set[str]] = defaultdict(set)
    for edge_id, edge in edges.items():
        props = edge.get("properties", {})
        if edge_id in (closed or set()) or props.get("status") != "open" or (step_free and props.get("accessibility") == "stairs"):
            continue
        source, target = props.get("source"), props.get("target")
        if source in nodes and target in nodes:
            adjacency[source].add(target)
            if props.get("reverse_cost") != -1:
                adjacency[target].add(source)
    visited, queue = {"N1"}, deque(["N1"])
    while queue:
        current = queue.popleft()
        for neighbour in adjacency[current] - visited:
            visited.add(neighbour)
            queue.append(neighbour)
    return visited


def main() -> int:
    validation = Validation()
    metadata = load_json(ROOT / "metadata.json", validation)
    validation.check(metadata.get("crs") == "EPSG:4326", "metadata.json: crs must be EPSG:4326")
    validation.check(metadata.get("source", {}).get("kind") == "synthetic", "metadata.json: source must remain synthetic")
    validation.check(metadata.get("license", {}).get("spdx") == "CC0-1.0", "metadata.json: fixture license must remain CC0-1.0")
    validation.check("not_for_real_navigation" in metadata.get("restrictions", []), "metadata.json: real-navigation restriction is required")
    bbox = metadata.get("bbox", [])
    if not (isinstance(bbox, list) and len(bbox) == 4 and all(isinstance(value, (int, float)) for value in bbox)):
        validation.errors.append("metadata.json: bbox must contain four numbers")
        bbox = [-180, -90, 180, 90]

    documents = {name: load_json(ROOT / name, validation) for name in FILES}
    pois = feature_map(documents["pois.geojson"], "pois.geojson", "Point", bbox, validation)
    entrances = feature_map(documents["entrances.geojson"], "entrances.geojson", "Point", bbox, validation)
    nodes = feature_map(documents["walkway_nodes.geojson"], "walkway_nodes.geojson", "Point", bbox, validation)
    edges = feature_map(documents["walkway_edges.geojson"], "walkway_edges.geojson", "LineString", bbox, validation)
    validation.check(set(pois) == POI_IDS, f"pois.geojson: IDs differ from authoritative five: {sorted(set(pois) ^ POI_IDS)}")
    validation.check(set(entrances) == ENTRANCE_IDS, f"entrances.geojson: IDs differ from authoritative five: {sorted(set(entrances) ^ ENTRANCE_IDS)}")
    validation.check(set(nodes) == set(NODE_POSITIONS), f"walkway_nodes.geojson: expected N1-N7, got {sorted(nodes)}")
    validation.check(set(edges) == set(EDGE_ENDPOINTS), f"walkway_edges.geojson: edge IDs differ: {sorted(set(edges) ^ set(EDGE_ENDPOINTS))}")

    for node_id, expected_position in NODE_POSITIONS.items():
        if node_id in nodes:
            actual = nodes[node_id].get("geometry", {}).get("coordinates", [])
            validation.check(actual == expected_position, f"{node_id}: coordinate differs from SAMPLE_DATA_SPEC")
            validation.check(nodes[node_id].get("properties", {}).get("source") == "synthetic_fixture", f"{node_id}: source must be synthetic_fixture")

    referenced_entrances: set[str] = set()
    for poi_id, poi in pois.items():
        props = poi.get("properties", {})
        expected_entrance, expected_node = POI_ENTRANCE_NODES.get(poi_id, (None, None))
        entrance_id = props.get("entrance_id")
        referenced_entrances.add(entrance_id)
        validation.check(entrance_id == expected_entrance, f"{poi_id}: entrance_id must be {expected_entrance}")
        validation.check(props.get("source") == "synthetic_fixture", f"{poi_id}: source must be synthetic_fixture")
        for locale in ("vi", "en"):
            translation = props.get("translations", {}).get(locale, {})
            validation.check(all(translation.get(field) for field in ("name", "short_description", "long_description")), f"{poi_id}: complete {locale} translation required")
        if entrance_id in entrances:
            entrance_props = entrances[entrance_id].get("properties", {})
            validation.check(entrance_props.get("poi_id") == poi_id, f"{entrance_id}: poi_id must be {poi_id}")
            validation.check(entrance_props.get("graph_node_ref") == expected_node, f"{entrance_id}: graph_node_ref must be {expected_node}")
            validation.check(entrance_props.get("is_primary") is True and entrance_props.get("is_active") is True, f"{entrance_id}: must be primary and active")
            if expected_node in nodes:
                distance = haversine_m(entrances[entrance_id]["geometry"]["coordinates"], nodes[expected_node]["geometry"]["coordinates"])
                validation.check(distance <= ENTRANCE_TOLERANCE_M, f"{entrance_id}: {distance:.1f} m from {expected_node}, exceeds 15 m")
    validation.check(referenced_entrances == set(entrances), "entrances.geojson: every entrance must be referenced once")

    for edge_id, edge in edges.items():
        props = edge.get("properties", {})
        expected_source, expected_target = EDGE_ENDPOINTS.get(edge_id, (None, None))
        source, target = props.get("source"), props.get("target")
        validation.check((source, target) == (expected_source, expected_target), f"{edge_id}: source/target differ from migration 004")
        validation.check(props.get("accessibility") == ("stairs" if edge_id == "N3-N6" else "step_free"), f"{edge_id}: accessibility differs from migration 004")
        validation.check(props.get("status") == "open" and props.get("source_name") == "synthetic_fixture", f"{edge_id}: must be open synthetic_fixture")
        coordinates = edge.get("geometry", {}).get("coordinates", [])
        if source in nodes and target in nodes and len(coordinates) >= 2:
            validation.check(haversine_m(coordinates[0], nodes[source]["geometry"]["coordinates"]) <= ENDPOINT_TOLERANCE_M, f"{edge_id}: first coordinate does not match source")
            validation.check(haversine_m(coordinates[-1], nodes[target]["geometry"]["coordinates"]) <= ENDPOINT_TOLERANCE_M, f"{edge_id}: last coordinate does not match target")
            measured = sum(haversine_m(a, b) for a, b in zip(coordinates, coordinates[1:]))
            for field in ("length_m", "cost", "reverse_cost"):
                value = props.get(field)
                validation.check(isinstance(value, (int, float)) and value > 0, f"{edge_id}: {field} must be positive")
                if isinstance(value, (int, float)):
                    validation.check(abs(value - measured) <= COST_TOLERANCE_M, f"{edge_id}: {field} {value} differs from geometry length {measured:.1f} m")

    node_ids = set(nodes)
    validation.check(reachable(node_ids, edges) == node_ids, "default graph must reach every node from N1")
    validation.check(reachable(node_ids, edges, step_free=True) == node_ids, "step-free graph must reach every node without N3-N6")
    validation.check({"N4", "N7"} <= reachable(node_ids, edges, closed={"N3-N4"}), "closing N3-N4 must retain routes to N4 and N7")

    if validation.errors:
        print(f"Geo fixture validation failed ({len(validation.errors)} error(s)):", file=sys.stderr)
        for error in validation.errors:
            print(f"- {error}", file=sys.stderr)
        return 1
    print(f"Geo fixture valid: {len(pois)} POIs, {len(entrances)} entrances, {len(nodes)} nodes, {len(edges)} edges; default, step-free and closure topology pass.")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
