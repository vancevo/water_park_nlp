#!/usr/bin/env python3
"""Run the checked-in query set against a local GET /v1/search endpoint."""

from __future__ import annotations

import argparse
import json
from pathlib import Path
from urllib.parse import urlencode
from urllib.request import urlopen


HERE = Path(__file__).resolve().parent


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--base-url", default="http://127.0.0.1:3000")
    parser.add_argument("--output", type=Path, required=True)
    args = parser.parse_args()

    dataset = json.loads((HERE / "queries.json").read_text(encoding="utf-8"))
    results: dict[str, list[str]] = {}
    for query in dataset["queries"]:
        params = urlencode(
            {"q": query["text"], "locale": query["locale"], "limit": 10}
        )
        with urlopen(f"{args.base_url.rstrip('/')}/v1/search?{params}", timeout=5) as response:
            body = json.load(response)
        results[query["id"]] = [item["id"] for item in body["items"]]

    args.output.write_text(
        json.dumps(
            {"dataset_id": dataset["dataset_id"], "results": results},
            ensure_ascii=False,
            indent=2,
        )
        + "\n",
        encoding="utf-8",
    )


if __name__ == "__main__":
    main()
