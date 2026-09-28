#!/usr/bin/env python3
"""Regression tests for the search evaluation harness."""

from __future__ import annotations

import json
import unittest
from pathlib import Path

from evaluate import evaluate, result_mapping
from lexical_baseline import run


HERE = Path(__file__).resolve().parent


def load(name: str):
    with (HERE / name).open(encoding="utf-8") as handle:
        return json.load(handle)


class EvaluationTest(unittest.TestCase):
    @classmethod
    def setUpClass(cls) -> None:
        cls.dataset = load("queries.json")
        with (HERE.parent / "geojson" / "pois.geojson").open(encoding="utf-8") as handle:
            cls.pois = json.load(handle)

    def test_perfect_run(self) -> None:
        results = {
            query["id"]: [item["poi_id"] for item in query["relevant"]]
            for query in self.dataset["queries"]
        }
        report = evaluate(self.dataset, results)
        self.assertEqual(report["recall_at_10"], 1.0)
        self.assertEqual(report["mrr"], 1.0)
        self.assertEqual(report["ndcg_at_10"], 1.0)
        self.assertEqual(report["zero_result_rate"], 0.1)
        self.assertEqual(report["expected_zero_result_accuracy"], 1.0)

    def test_duplicate_result_is_rejected(self) -> None:
        with self.assertRaisesRegex(ValueError, "duplicate"):
            result_mapping({"results": {"q001": [
                "00000000-0000-4000-8000-000000000101",
                "00000000-0000-4000-8000-000000000101",
            ]}})

    def test_checked_in_baseline_is_reproducible(self) -> None:
        actual = run(self.dataset, self.pois, 10)
        self.assertEqual(actual, load("baseline_results.json"))
        self.assertEqual(evaluate(self.dataset, actual["results"]), load("baseline_report.json"))


if __name__ == "__main__":
    unittest.main()
