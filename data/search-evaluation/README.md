# Synthetic search evaluation

This directory benchmarks search behavior against the five fictional POIs in
`../geojson/pois.geojson`. It is test data only: it does not describe actual
Dam Sen attractions, facilities, paths, or accessibility.

## Contents

- `queries.json`: 50 Vietnamese/English queries with relevance judgments.
- `schema.json`: JSON Schema for the judgment dataset and result mapping.
- `evaluate.py`: dependency-free Recall@10, MRR, nDCG@10, and zero-result evaluator.
- `lexical_baseline.py`: deterministic accent-insensitive/fuzzy lexical runner.
- `baseline_results.json`: checked-in output from the lexical runner.
- `baseline_report.json`: checked-in evaluation of that output.
- `validate.py` and `test_evaluation.py`: invariant and regression checks.

The query mix is fixed so regressions are visible: 10 exact name, 8 Vietnamese
without diacritics, 10 semantic intent, 8 typo, 9 category/location phrasing,
and 5 expected-zero-result cases. Every positive judgment refers to one of the
five fixture POI IDs. Cardinal location judgments are derived only from the
fixture coordinates.

## Result contract

Pass either a direct query-to-ranking object or the recommended wrapper:

```json
{
  "dataset_id": "dam-sen-synthetic-search-v1",
  "results": {
    "q001": ["00000000-0000-4000-8000-000000000101"],
    "q002": []
  }
}
```

Rankings contain unique POI IDs in descending rank order. Missing query IDs are
treated as empty rankings and reported as `missing_query_count`; unknown query
IDs and duplicate POI IDs are errors.

Recall@10, MRR, and nDCG@10 are macro-averaged over the 45 queries that have at
least one relevant POI. A zero-result judgment has no ideal ranked list, so it
is excluded from those three ranking metrics. `zero_result_rate` is the share
of all 50 queries for which the system returned nothing.
`expected_zero_result_accuracy` separately shows how often the five explicit
zero-result queries correctly returned nothing.

## Run

No packages beyond Python 3's standard library are required.

```sh
python3 data/search-evaluation/validate.py
python3 data/search-evaluation/lexical_baseline.py
python3 data/search-evaluation/evaluate.py \
  data/search-evaluation/baseline_results.json \
  --output data/search-evaluation/baseline_report.json
python3 data/search-evaluation/test_evaluation.py
```

Để đo trực tiếp implementation `GET /v1/search` đang chạy local:

```sh
python3 data/search-evaluation/run_http_search.py \
  --base-url http://127.0.0.1:3000 --output /tmp/http-search-results.json
python3 data/search-evaluation/evaluate.py /tmp/http-search-results.json
```

To evaluate another system, serialize its rankings in the result contract and
pass that JSON file to `evaluate.py`. Do not tune against the checked-in report
without retaining a separate held-out set once real, licensed judgments exist.

## Baseline v1.1

The stored standard-library lexical baseline produces:

| Metric | Value |
|---|---:|
| Recall@10 | 0.911111 |
| MRR | 0.905556 |
| nDCG@10 | 0.900181 |
| Zero-result rate | 0.100000 |
| Expected-zero-result accuracy | 0.600000 |

This baseline is intentionally small and transparent. It normalizes Vietnamese
diacritics, compares exact/fuzzy tokens, searches the selected locale's name
and short description plus category, and uses POI ID as a stable tie-breaker.
It has no embedding model and no coordinate-aware interpretation; the weaker
category/location slice records that limitation for later systems.

## Current API lexical result

Running `run_http_search.py` against migration `007` and the real PostgreSQL
repository on 2026-09-25 produced Recall@10/MRR/nDCG@10 of `0.60`, with exact,
no-diacritic and typo slices at `1.0` and expected-zero accuracy at `1.0`.
Semantic intent (`0.10`) and category/location (`0.0`) are the explicit gap for
T43 hybrid retrieval; this result must not be presented as semantic search.
