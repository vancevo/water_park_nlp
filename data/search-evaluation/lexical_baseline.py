#!/usr/bin/env python3
"""Run a deterministic, dependency-free lexical baseline over synthetic POIs."""

from __future__ import annotations

import argparse
import difflib
import json
import re
import unicodedata
from pathlib import Path
from typing import Any


HERE = Path(__file__).resolve().parent
TOKEN_RE = re.compile(r"[a-z0-9_]+")


def load_json(path: Path) -> Any:
    with path.open(encoding="utf-8") as handle:
        return json.load(handle)


def normalize(value: str) -> str:
    value = value.lower().replace("đ", "d")
    value = "".join(char for char in unicodedata.normalize("NFD", value) if unicodedata.category(char) != "Mn")
    return " ".join(TOKEN_RE.findall(value))


def token_score(query_token: str, document_token: str) -> float:
    if query_token == document_token:
        return 2.0
    if len(query_token) >= 4 and len(document_token) >= 4:
        ratio = difflib.SequenceMatcher(None, query_token, document_token).ratio()
        if ratio >= 0.82:
            return ratio
    return 0.0


def score(query_text: str, document: str) -> float:
    query = normalize(query_text)
    normalized_document = normalize(document)
    if not query:
        return 0.0
    total = 8.0 if query in normalized_document else 0.0
    document_tokens = normalized_document.split()
    for query_token in query.split():
        total += max((token_score(query_token, token) for token in document_tokens), default=0.0)
    return total


def poi_document(feature: dict[str, Any], locale: str) -> str:
    properties = feature["properties"]
    translation = properties["translations"][locale]
    category = properties["category"].replace("_", " ")
    return " ".join([translation["name"], translation["short_description"], category])


def run(dataset: dict[str, Any], pois: dict[str, Any], top_k: int) -> dict[str, Any]:
    rankings: dict[str, list[str]] = {}
    for query in dataset["queries"]:
        candidates = []
        for feature in pois["features"]:
            value = score(query["text"], poi_document(feature, query["locale"]))
            if value > 0:
                candidates.append((value, feature["id"]))
        candidates.sort(key=lambda item: (-item[0], item[1]))
        rankings[query["id"]] = [poi_id for _, poi_id in candidates[:top_k]]
    return {
        "dataset_id": dataset["dataset_id"],
        "system": "stdlib-lexical-baseline-v1",
        "results": rankings,
    }


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--dataset", type=Path, default=HERE / "queries.json")
    parser.add_argument("--pois", type=Path, default=HERE.parent / "geojson" / "pois.geojson")
    parser.add_argument("--output", type=Path, default=HERE / "baseline_results.json")
    parser.add_argument("--top-k", type=int, default=10)
    args = parser.parse_args()
    if args.top_k < 1:
        parser.error("--top-k must be positive")

    payload = run(load_json(args.dataset), load_json(args.pois), args.top_k)
    args.output.write_text(json.dumps(payload, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    print(f"wrote {len(payload['results'])} rankings to {args.output}")


if __name__ == "__main__":
    main()
