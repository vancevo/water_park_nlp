#!/usr/bin/env python3
"""Validate the TTS evaluation corpus, lexicon, manifest and report fixtures.

Dependency-free (stdlib only), like data/search-evaluation. Usage:

    python3 data/tts-evaluation/validate.py                     # validate, exit 1 on error
    python3 data/tts-evaluation/validate.py --update-checksums  # rewrite manifest sha256
    python3 data/tts-evaluation/validate.py --export-benchmark OUT.json [--locale vi]

The export writes {"schema": "tts-benchmark-sentences/v1", "sentences": [...]} with
id/locale/category/text, the shape read by apps/worker/src/tts/piper/run-benchmark.ts.
"""

from __future__ import annotations

import argparse
import hashlib
import json
import re
import sys
from pathlib import Path

HERE = Path(__file__).resolve().parent
CORPUS_SCHEMA = "tts-evaluation-corpus/v1"
LEXICON_SCHEMA = "tts-pronunciation-lexicon/v1"
REPORT_SCHEMA = "tts-evaluation-report/v1"
CATEGORIES = {
    "poi-name",
    "place-name",
    "number-date",
    "abbreviation",
    "code-switch",
    "punctuation",
    "long",
    "safety",
}
NORMALIZED_CATEGORIES = {"number-date", "abbreviation"}
MIN_PER_CATEGORY = {"vi": 2, "en": 2, "fr": 2}
MIN_VI_CORE = {"poi-name": 5, "number-date": 3, "abbreviation": 3, "code-switch": 3}
LEXICON_CATEGORIES = {"poi-name", "place-name", "abbreviation", "code-switch"}
REVIEW_STATUSES = {"needs_native_review", "approved"}
ID_PATTERN = re.compile(r"^[a-z]{2,3}(-[a-z0-9]+)+$")
LOCALE_PATTERN = re.compile(r"^[a-z]{2,3}(-[A-Za-z0-9]{2,8})*$")
# Evaluation text must never contain personal data.
PII_PATTERNS = {
    "email": re.compile(r"[\w.+-]+@[\w-]+\.[\w.]+"),
    "phone": re.compile(r"(?<!\d)(?:\+?84|0)\d{9,10}(?!\d)"),
    "url": re.compile(r"https?://", re.I),
}
FORBIDDEN_REPORT_KEYS = {"text", "transcript", "audio", "audioBase64"}


def load_json(path: Path):
    with path.open(encoding="utf-8") as handle:
        return json.load(handle)


def sha256_of(path: Path) -> str:
    return hashlib.sha256(path.read_bytes()).hexdigest()


def data_files(root: Path) -> list[str]:
    """Every data file the manifest must cover (code, docs and the manifest itself excluded)."""
    return sorted(
        path.relative_to(root).as_posix()
        for path in root.rglob("*.json")
        if path.name != "manifest.json" and "__pycache__" not in path.parts
    )


def validate_manifest(root: Path, manifest, errors: list[str]) -> set[str]:
    if manifest.get("schema") != "tts-evaluation-manifest/v1":
        errors.append("manifest: unexpected schema")
    if manifest.get("trainingUse") != "forbidden":
        errors.append("manifest: trainingUse must be 'forbidden' (evaluation-only data)")
    for key in ("datasetId", "version"):
        if not manifest.get(key):
            errors.append(f"manifest: missing {key}")
    source_ids: set[str] = set()
    for source in manifest.get("sources", []):
        sid = source.get("id", "")
        if not sid:
            errors.append("manifest: source without id")
            continue
        if sid in source_ids:
            errors.append(f"manifest: duplicate source {sid}")
        source_ids.add(sid)
        for key in ("license", "origin", "rightsHolder"):
            if not str(source.get(key, "")).strip():
                errors.append(f"manifest: source {sid} missing {key}")
    listed: set[str] = set()
    for entry in manifest.get("files", []):
        rel = entry.get("path", "")
        listed.add(rel)
        if not str(entry.get("license", "")).strip():
            errors.append(f"manifest: file {rel} missing license")
        sources = entry.get("sourceIds") or []
        if not sources:
            errors.append(f"manifest: file {rel} missing sourceIds")
        for sid in sources:
            if sid not in source_ids:
                errors.append(f"manifest: file {rel} references unknown source {sid}")
        checksum = entry.get("sha256", "")
        path = root / rel
        if not re.fullmatch(r"[0-9a-f]{64}", checksum or ""):
            errors.append(f"manifest: file {rel} missing sha256")
        elif not path.is_file():
            errors.append(f"manifest: file {rel} does not exist")
        elif sha256_of(path) != checksum:
            errors.append(f"manifest: checksum mismatch for {rel} (run --update-checksums after review)")
    for rel in data_files(root):
        if rel not in listed:
            errors.append(f"manifest: data file {rel} is not listed (no license/source)")
    return source_ids


def check_text(owner: str, text: str, errors: list[str]) -> None:
    if not isinstance(text, str) or not text.strip():
        errors.append(f"{owner}: empty text")
        return
    for name, pattern in PII_PATTERNS.items():
        if pattern.search(text):
            errors.append(f"{owner}: text looks like it contains {name} data")


def validate_lexicon(root: Path, source_ids: set[str], errors: list[str]) -> set[str]:
    lexicon = load_json(root / "lexicon" / "pronunciation.json")
    if lexicon.get("schema") != LEXICON_SCHEMA:
        errors.append("lexicon: unexpected schema")
    ids: set[str] = set()
    for entry in lexicon.get("entries", []):
        eid = entry.get("id", "")
        owner = f"lexicon {eid or '?'}"
        if not ID_PATTERN.match(eid):
            errors.append(f"{owner}: invalid id")
        if eid in ids:
            errors.append(f"{owner}: duplicate id")
        ids.add(eid)
        if entry.get("category") not in LEXICON_CATEGORIES:
            errors.append(f"{owner}: invalid category")
        if not LOCALE_PATTERN.match(entry.get("locale", "")):
            errors.append(f"{owner}: invalid locale")
        for key in ("term", "spokenForm"):
            if not str(entry.get(key, "")).strip():
                errors.append(f"{owner}: missing {key}")
        if not entry.get("appliesToLocales"):
            errors.append(f"{owner}: missing appliesToLocales")
        if entry.get("reviewStatus") not in REVIEW_STATUSES:
            errors.append(f"{owner}: invalid reviewStatus")
        if entry.get("sourceId") not in source_ids:
            errors.append(f"{owner}: missing or unknown sourceId")
    return ids


def validate_corpus(root: Path, source_ids: set[str], lexicon_ids: set[str], errors: list[str]):
    sentences: dict[str, dict] = {}
    for path in sorted((root / "corpus").glob("*.json")):
        corpus = load_json(path)
        locale = corpus.get("locale", "")
        if corpus.get("schema") != CORPUS_SCHEMA:
            errors.append(f"{path.name}: unexpected schema")
        if path.stem != locale:
            errors.append(f"{path.name}: file name must match locale {locale!r}")
        counts: dict[str, int] = {}
        for sentence in corpus.get("sentences", []):
            sid = sentence.get("id", "")
            owner = f"{path.name} {sid or '?'}"
            if not ID_PATTERN.match(sid) or not sid.startswith(f"{locale}-"):
                errors.append(f"{owner}: id must be '<locale>-...' lowercase")
            if sid in sentences:
                errors.append(f"{owner}: duplicate sentence id")
            sentences[sid] = sentence
            if sentence.get("locale") != locale:
                errors.append(f"{owner}: locale does not match file")
            category = sentence.get("category")
            if category not in CATEGORIES:
                errors.append(f"{owner}: invalid category {category!r}")
            counts[category] = counts.get(category, 0) + 1
            if sentence.get("split") != "eval":
                errors.append(f"{owner}: split must be 'eval' (no training data here)")
            if sentence.get("sourceId") not in source_ids:
                errors.append(f"{owner}: missing or unknown sourceId (license/source required)")
            if sentence.get("synthetic") is not True:
                errors.append(f"{owner}: synthetic flag must be true for original text")
            check_text(owner, sentence.get("text"), errors)
            if category in NORMALIZED_CATEGORIES:
                normalized = sentence.get("expectedNormalized", "")
                check_text(f"{owner} expectedNormalized", normalized, errors)
                if isinstance(normalized, str) and re.search(r"\d", normalized):
                    errors.append(f"{owner}: expectedNormalized must spell out digits")
            for ref in sentence.get("lexiconRefs", []):
                if ref not in lexicon_ids:
                    errors.append(f"{owner}: unknown lexicon ref {ref}")
        minimum = MIN_PER_CATEGORY.get(locale, 1)
        for category in sorted(CATEGORIES):
            required = MIN_VI_CORE.get(category, minimum) if locale == "vi" else minimum
            if counts.get(category, 0) < required:
                errors.append(f"{path.name}: needs at least {required} '{category}' sentences")
    for locale in ("vi", "en", "fr"):
        if not (root / "corpus" / f"{locale}.json").is_file():
            errors.append(f"corpus: missing {locale}.json")
    return sentences


def evaluate_gate(report: dict, thresholds: dict) -> list[str]:
    """Release-gate failures for one locale report, using thresholds fixed in advance."""
    failures: list[str] = []
    operational = thresholds["operational"]
    count = report.get("count") or 0
    if count and report["failed"] / count > operational["maxFailedRatio"]:
        failures.append("failed-ratio")
    p95 = report.get("p95GenerationMs")
    if p95 is not None and p95 > operational["maxP95GenerationMs"]:
        failures.append("p95-generation")
    rtf = report.get("meanRealTimeFactor")
    if rtf is not None and rtf > operational["maxMeanRealTimeFactor"]:
        failures.append("real-time-factor")
    automated = thresholds["automated"]
    checks = [s.get("automatedChecks") for s in report.get("samples", []) if s.get("ok")]
    for check in filter(None, checks):
        if check.get("decodable") is False:
            failures.append("decodable")
        if check.get("clippedSampleRatio", 0) > automated["maxClippedSampleRatio"]:
            failures.append("clipping")
        edge = max(check.get("leadingSilenceSeconds", 0), check.get("trailingSilenceSeconds", 0))
        if edge > automated["maxLeadingOrTrailingSilenceSeconds"]:
            failures.append("edge-silence")
        if check.get("internalSilenceRatio", 0) > automated["maxInternalSilenceRatio"]:
            failures.append("internal-silence")
    locale_rules = thresholds["locales"].get(report.get("locale"), {})
    ratings = report.get("humanRatings")
    if ratings:
        if ratings.get("naturalnessMos", 0) < locale_rules.get("minNaturalnessMos", 0):
            failures.append("naturalness")
        if ratings.get("intelligibilityMos", 0) < locale_rules.get("minIntelligibilityMos", 0):
            failures.append("intelligibility")
        if ratings.get("criticalPoiNameErrors", 0) > thresholds["pronunciation"]["maxCriticalPoiNameErrors"]:
            failures.append("poi-name-pronunciation")
    else:
        failures.append("missing-human-ratings")
    return sorted(set(failures))


def find_forbidden_keys(value, path="") -> list[str]:
    found: list[str] = []
    if isinstance(value, dict):
        for key, item in value.items():
            if key in FORBIDDEN_REPORT_KEYS:
                found.append(f"{path}.{key}" if path else key)
            found.extend(find_forbidden_keys(item, f"{path}.{key}" if path else key))
    elif isinstance(value, list):
        for index, item in enumerate(value):
            found.extend(find_forbidden_keys(item, f"{path}[{index}]"))
    return found


def validate_report(name: str, document, sentences: dict, thresholds: dict, errors: list[str]) -> None:
    if document.get("schema") != REPORT_SCHEMA:
        errors.append(f"{name}: unexpected schema")
    if not document.get("corpus", {}).get("datasetId"):
        errors.append(f"{name}: missing corpus.datasetId")
    for key in find_forbidden_keys(document):
        errors.append(f"{name}: must not contain transcript/audio field {key}")
    required = (
        "provider", "model", "modelVersion", "voiceId", "locale", "count", "ok", "failed",
        "p50GenerationMs", "p95GenerationMs", "meanRealTimeFactor", "totalSizeBytes",
        "samples", "generatedAt",
    )
    for index, report in enumerate(document.get("reports", [])):
        owner = f"{name} reports[{index}]"
        missing = [key for key in required if key not in report]
        if missing:
            errors.append(f"{owner}: missing {', '.join(missing)}")
            continue
        if report["modelVersion"] in ("", "main", "latest"):
            errors.append(f"{owner}: modelVersion must be pinned")
        samples = report["samples"]
        if len(samples) != report["count"] or report["ok"] + report["failed"] != report["count"]:
            errors.append(f"{owner}: count/ok/failed do not match samples")
        if sum(1 for s in samples if s.get("ok")) != report["ok"]:
            errors.append(f"{owner}: ok does not match successful samples")
        p50, p95 = report["p50GenerationMs"], report["p95GenerationMs"]
        if p50 is not None and p95 is not None and p50 > p95:
            errors.append(f"{owner}: p50 greater than p95")
        for sample in samples:
            sentence = sentences.get(sample.get("id"))
            if sentence is None:
                errors.append(f"{owner}: unknown sample id {sample.get('id')}")
            elif sentence["locale"] != report["locale"]:
                errors.append(f"{owner}: sample {sample['id']} belongs to another locale")
            if not sample.get("ok") and not re.fullmatch(r"TTS_[A-Z_]+", sample.get("errorCode", "")):
                errors.append(f"{owner}: failed sample {sample.get('id')} needs a stable TTS_ error code")
        if "gate" in report:
            expected = evaluate_gate(report, thresholds)
            gate = report["gate"]
            if gate.get("passed") != (not expected) or sorted(gate.get("failures", [])) != expected:
                errors.append(f"{owner}: gate does not match thresholds (expected {expected})")


def validate(root: Path = HERE) -> list[str]:
    errors: list[str] = []
    manifest = load_json(root / "manifest.json")
    source_ids = validate_manifest(root, manifest, errors)
    lexicon_ids = validate_lexicon(root, source_ids, errors)
    sentences = validate_corpus(root, source_ids, lexicon_ids, errors)
    thresholds = load_json(root / "thresholds.json")
    if thresholds.get("decidedBeforeResults") is not True:
        errors.append("thresholds: must be decided before results")
    for path in sorted((root / "reports" / "fixtures").glob("*.json")):
        validate_report(path.name, load_json(path), sentences, thresholds, errors)
    return errors


def export_benchmark(root: Path, locale: str | None) -> dict:
    sentences = []
    for path in sorted((root / "corpus").glob("*.json")):
        for sentence in load_json(path)["sentences"]:
            if locale is None or sentence["locale"] == locale:
                sentences.append({key: sentence[key] for key in ("id", "locale", "category", "text")})
    manifest = load_json(root / "manifest.json")
    return {
        "schema": "tts-benchmark-sentences/v1",
        "note": f"Exported from {manifest['datasetId']} {manifest['version']} (evaluation only, never training).",
        "sentences": sentences,
    }


def update_checksums(root: Path) -> None:
    manifest_path = root / "manifest.json"
    manifest = load_json(manifest_path)
    for entry in manifest["files"]:
        path = root / entry["path"]
        if path.is_file():
            entry["sha256"] = sha256_of(path)
    manifest_path.write_text(json.dumps(manifest, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    parser.add_argument("--root", type=Path, default=HERE)
    parser.add_argument("--update-checksums", action="store_true")
    parser.add_argument("--export-benchmark", type=Path)
    parser.add_argument("--locale")
    args = parser.parse_args(argv)
    if args.update_checksums:
        update_checksums(args.root)
    errors = validate(args.root)
    if errors:
        for error in errors:
            print(f"ERROR: {error}", file=sys.stderr)
        print(f"FAIL: {len(errors)} problem(s)", file=sys.stderr)
        return 1
    if args.export_benchmark:
        document = export_benchmark(args.root, args.locale)
        if not document["sentences"]:
            # An empty benchmark would "pass" every gate; refuse it instead.
            print(f"ERROR: no corpus sentences for locale {args.locale!r}", file=sys.stderr)
            return 1
        args.export_benchmark.write_text(json.dumps(document, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
        print(f"Exported {len(document['sentences'])} sentences to {args.export_benchmark}")
    counts = {}
    for path in sorted((args.root / "corpus").glob("*.json")):
        counts[path.stem] = len(load_json(path)["sentences"])
    print(f"PASS: corpus {counts}, lexicon + manifest + report fixtures valid")
    return 0


if __name__ == "__main__":
    sys.exit(main())
