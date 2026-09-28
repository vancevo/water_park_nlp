#!/usr/bin/env python3
"""Validate dataset invariants without third-party packages."""

from __future__ import annotations

import json
from collections import Counter
from pathlib import Path


HERE = Path(__file__).resolve().parent
EXPECTED_CASES = {
    "exact": 10,
    "no_diacritic": 8,
    "semantic_intent": 10,
    "typo": 8,
    "category_location": 9,
    "zero_result": 5,
}


def load(path: Path):
    with path.open(encoding="utf-8") as handle:
        return json.load(handle)


def main() -> None:
    dataset = load(HERE / "queries.json")
    pois = load(HERE.parent / "geojson" / "pois.geojson")
    poi_ids = {feature["id"] for feature in pois["features"]}
    queries = dataset["queries"]
    ids = [query["id"] for query in queries]

    assert len(queries) == 50, f"expected 50 queries, got {len(queries)}"
    assert len(ids) == len(set(ids)), "query ids must be unique"
    assert Counter(query["case_type"] for query in queries) == EXPECTED_CASES
    assert {query["locale"] for query in queries} == {"vi", "en"}
    assert "Synthetic" in dataset["scope"] and "not real" in dataset["scope"]

    for query in queries:
        assert query["text"].strip(), f"{query['id']}: empty query text"
        relevant_ids = [item["poi_id"] for item in query["relevant"]]
        assert len(relevant_ids) == len(set(relevant_ids)), f"{query['id']}: duplicate judgment"
        assert set(relevant_ids) <= poi_ids, f"{query['id']}: unknown POI judgment"
        assert all(1 <= item["grade"] <= 3 for item in query["relevant"])
        if query["case_type"] == "zero_result":
            assert not relevant_ids, f"{query['id']}: zero-result query has a judgment"
        else:
            assert relevant_ids, f"{query['id']}: positive query has no judgment"

    print(f"PASS: {len(queries)} queries, {len(poi_ids)} fixture POIs, cases={dict(EXPECTED_CASES)}")


if __name__ == "__main__":
    main()
