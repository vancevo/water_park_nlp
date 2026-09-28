#!/usr/bin/env python3
"""Evaluate ranked POI result lists against the synthetic judgments."""

from __future__ import annotations

import argparse
import json
import math
from collections import defaultdict
from pathlib import Path
from typing import Any


HERE = Path(__file__).resolve().parent


def load_json(path: Path) -> Any:
    with path.open(encoding="utf-8") as handle:
        return json.load(handle)


def result_mapping(payload: Any) -> dict[str, list[str]]:
    mapping = payload.get("results", payload) if isinstance(payload, dict) else None
    if not isinstance(mapping, dict):
        raise ValueError("results must be a JSON object keyed by query id")
    parsed: dict[str, list[str]] = {}
    for query_id, ranking in mapping.items():
        if not isinstance(query_id, str) or not isinstance(ranking, list):
            raise ValueError("each result entry must map a string query id to an array")
        if any(not isinstance(poi_id, str) for poi_id in ranking):
            raise ValueError(f"{query_id}: every ranked POI id must be a string")
        if len(ranking) != len(set(ranking)):
            raise ValueError(f"{query_id}: duplicate POI ids are not allowed")
        parsed[query_id] = ranking
    return parsed


def dcg(grades: list[int]) -> float:
    return sum((2**grade - 1) / math.log2(rank + 2) for rank, grade in enumerate(grades))


def per_query_metrics(query: dict[str, Any], ranking: list[str], cutoff: int) -> dict[str, float]:
    grades = {item["poi_id"]: item["grade"] for item in query["relevant"]}
    top = ranking[:cutoff]
    if not grades:
        return {
            "recall_at_10": 0.0,
            "reciprocal_rank": 0.0,
            "ndcg_at_10": 0.0,
            "has_judgment": 0.0,
        }

    hits = [poi_id for poi_id in top if poi_id in grades]
    first_rank = next((index + 1 for index, poi_id in enumerate(top) if poi_id in grades), None)
    observed = [grades.get(poi_id, 0) for poi_id in top]
    ideal = sorted(grades.values(), reverse=True)[:cutoff]
    ideal_dcg = dcg(ideal)
    return {
        "recall_at_10": len(hits) / len(grades),
        "reciprocal_rank": 0.0 if first_rank is None else 1.0 / first_rank,
        "ndcg_at_10": 0.0 if ideal_dcg == 0 else dcg(observed) / ideal_dcg,
        "has_judgment": 1.0,
    }


def mean(values: list[float]) -> float:
    return sum(values) / len(values) if values else 0.0


def evaluate(dataset: dict[str, Any], results: dict[str, list[str]], cutoff: int = 10) -> dict[str, Any]:
    queries = dataset["queries"]
    known_ids = {query["id"] for query in queries}
    unknown = sorted(set(results) - known_ids)
    if unknown:
        raise ValueError(f"results contain unknown query ids: {', '.join(unknown)}")

    judged_metrics: list[dict[str, float]] = []
    by_case: dict[str, list[dict[str, float]]] = defaultdict(list)
    empty_count = 0
    expected_zero = 0
    correct_zero = 0
    for query in queries:
        ranking = results.get(query["id"], [])
        empty_count += not ranking
        metrics = per_query_metrics(query, ranking, cutoff)
        if metrics["has_judgment"]:
            judged_metrics.append(metrics)
            by_case[query["case_type"]].append(metrics)
        else:
            expected_zero += 1
            correct_zero += not ranking

    def aggregate(items: list[dict[str, float]]) -> dict[str, float]:
        return {
            "recall_at_10": round(mean([item["recall_at_10"] for item in items]), 6),
            "mrr": round(mean([item["reciprocal_rank"] for item in items]), 6),
            "ndcg_at_10": round(mean([item["ndcg_at_10"] for item in items]), 6),
        }

    return {
        "dataset_id": dataset["dataset_id"],
        "cutoff": cutoff,
        "query_count": len(queries),
        "judged_query_count": len(judged_metrics),
        **aggregate(judged_metrics),
        "zero_result_rate": round(empty_count / len(queries), 6),
        "expected_zero_result_accuracy": round(correct_zero / expected_zero, 6) if expected_zero else None,
        "missing_query_count": len(known_ids - set(results)),
        "by_case": {case: aggregate(items) for case, items in sorted(by_case.items())},
    }


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("results", type=Path, help="JSON result mapping or object containing a results mapping")
    parser.add_argument("--dataset", type=Path, default=HERE / "queries.json")
    parser.add_argument("--output", type=Path, help="also write the report to this JSON file")
    args = parser.parse_args()

    dataset = load_json(args.dataset)
    report = evaluate(dataset, result_mapping(load_json(args.results)))
    rendered = json.dumps(report, ensure_ascii=False, indent=2) + "\n"
    if args.output:
        args.output.write_text(rendered, encoding="utf-8")
    print(rendered, end="")


if __name__ == "__main__":
    main()
