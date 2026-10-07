#!/usr/bin/env python3
"""Regression tests for the TTS evaluation dataset validator (stdlib unittest)."""

from __future__ import annotations

import json
import shutil
import sys
import tempfile
import unittest
from pathlib import Path

HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(HERE))

from validate import evaluate_gate, export_benchmark, update_checksums, validate  # noqa: E402


class DatasetCopy:
    """Temporary copy of the dataset that a test can mutate."""

    def __enter__(self) -> "DatasetCopy":
        self.tmp = tempfile.TemporaryDirectory()
        self.root = Path(self.tmp.name) / "tts-evaluation"
        shutil.copytree(HERE, self.root, ignore=shutil.ignore_patterns("__pycache__"))
        return self

    def __exit__(self, *exc) -> None:
        self.tmp.cleanup()

    def load(self, rel: str):
        return json.loads((self.root / rel).read_text(encoding="utf-8"))

    def save(self, rel: str, value, refresh: bool = True) -> None:
        (self.root / rel).write_text(json.dumps(value, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
        if refresh:
            update_checksums(self.root)

    def errors(self) -> list[str]:
        return validate(self.root)


class ValidatorTest(unittest.TestCase):
    def assertRejected(self, errors: list[str], fragment: str) -> None:
        self.assertTrue(any(fragment in error for error in errors), f"{fragment!r} not in {errors}")

    def test_checked_in_dataset_is_valid(self) -> None:
        self.assertEqual(validate(HERE), [])

    def test_rejects_missing_source_license(self) -> None:
        with DatasetCopy() as data:
            manifest = data.load("manifest.json")
            manifest["sources"][0]["license"] = ""
            data.save("manifest.json", manifest, refresh=False)
            self.assertRejected(data.errors(), "missing license")

    def test_rejects_file_without_license_or_sources(self) -> None:
        with DatasetCopy() as data:
            manifest = data.load("manifest.json")
            manifest["files"][0]["license"] = ""
            manifest["files"][1]["sourceIds"] = []
            data.save("manifest.json", manifest, refresh=False)
            errors = data.errors()
            self.assertRejected(errors, "corpus/vi.json missing license")
            self.assertRejected(errors, "corpus/en.json missing sourceIds")

    def test_rejects_checksum_mismatch_and_missing_checksum(self) -> None:
        with DatasetCopy() as data:
            corpus = data.load("corpus/en.json")
            corpus["sentences"][0]["text"] += " Edited."
            data.save("corpus/en.json", corpus, refresh=False)
            self.assertRejected(data.errors(), "checksum mismatch for corpus/en.json")
            manifest = data.load("manifest.json")
            manifest["files"][0]["sha256"] = ""
            data.save("manifest.json", manifest, refresh=False)
            self.assertRejected(data.errors(), "corpus/vi.json missing sha256")

    def test_rejects_unlisted_data_file(self) -> None:
        with DatasetCopy() as data:
            (data.root / "corpus" / "de.json").write_text(
                json.dumps({"schema": "tts-evaluation-corpus/v1", "locale": "de", "sentences": []}),
                encoding="utf-8",
            )
            self.assertRejected(data.errors(), "corpus/de.json is not listed")

    def test_rejects_sentence_without_known_source(self) -> None:
        with DatasetCopy() as data:
            corpus = data.load("corpus/vi.json")
            corpus["sentences"][0]["sourceId"] = "scraped-website"
            del corpus["sentences"][1]["sourceId"]
            data.save("corpus/vi.json", corpus)
            errors = data.errors()
            self.assertRejected(errors, "vi-poi-001: missing or unknown sourceId")
            self.assertRejected(errors, "vi-poi-002: missing or unknown sourceId")

    def test_rejects_duplicates_training_split_and_bad_categories(self) -> None:
        with DatasetCopy() as data:
            corpus = data.load("corpus/fr.json")
            corpus["sentences"][1]["id"] = corpus["sentences"][0]["id"]
            corpus["sentences"][2]["split"] = "train"
            corpus["sentences"][3]["category"] = "poetry"
            data.save("corpus/fr.json", corpus)
            errors = data.errors()
            self.assertRejected(errors, "duplicate sentence id")
            self.assertRejected(errors, "split must be 'eval'")
            self.assertRejected(errors, "invalid category 'poetry'")

    def test_requires_spelled_out_normalisation_and_category_coverage(self) -> None:
        with DatasetCopy() as data:
            corpus = data.load("corpus/en.json")
            number = next(s for s in corpus["sentences"] if s["category"] == "number-date")
            number["expectedNormalized"] = "Open at 8."
            corpus["sentences"] = [s for s in corpus["sentences"] if s["category"] != "safety"]
            data.save("corpus/en.json", corpus)
            errors = data.errors()
            self.assertRejected(errors, "expectedNormalized must spell out digits")
            self.assertRejected(errors, "needs at least 2 'safety'")

    def test_rejects_personal_data_in_text(self) -> None:
        with DatasetCopy() as data:
            corpus = data.load("corpus/vi.json")
            corpus["sentences"][0]["text"] = "Liên hệ khach@example.com hoặc 0912345678."
            data.save("corpus/vi.json", corpus)
            errors = data.errors()
            self.assertRejected(errors, "email")
            self.assertRejected(errors, "phone")

    def test_rejects_unknown_lexicon_reference_and_unreviewed_status(self) -> None:
        with DatasetCopy() as data:
            corpus = data.load("corpus/vi.json")
            corpus["sentences"][0]["lexiconRefs"] = ["vi-missing"]
            data.save("corpus/vi.json", corpus)
            lexicon = data.load("lexicon/pronunciation.json")
            lexicon["entries"][0]["reviewStatus"] = "guess"
            data.save("lexicon/pronunciation.json", lexicon)
            errors = data.errors()
            self.assertRejected(errors, "unknown lexicon ref vi-missing")
            self.assertRejected(errors, "invalid reviewStatus")

    def test_report_privacy_and_consistency(self) -> None:
        with DatasetCopy() as data:
            report = data.load("reports/fixtures/example-report.json")
            first = report["reports"][0]
            first["samples"][0]["text"] = "leaked transcript"
            first["ok"] -= 1
            first["modelVersion"] = "latest"
            report["reports"][1]["samples"][0]["id"] = "vi-poi-001"
            data.save("reports/fixtures/example-report.json", report)
            errors = data.errors()
            self.assertRejected(errors, "must not contain transcript/audio field")
            self.assertRejected(errors, "count/ok/failed do not match")
            self.assertRejected(errors, "modelVersion must be pinned")
            self.assertRejected(errors, "belongs to another locale")

    def test_report_gate_must_match_thresholds(self) -> None:
        with DatasetCopy() as data:
            report = data.load("reports/fixtures/example-report.json")
            report["reports"][1]["gate"] = {"passed": True, "failures": []}
            data.save("reports/fixtures/example-report.json", report)
            self.assertRejected(data.errors(), "gate does not match thresholds")

    def test_gate_evaluation(self) -> None:
        thresholds = json.loads((HERE / "thresholds.json").read_text(encoding="utf-8"))
        base = {
            "locale": "vi",
            "count": 2,
            "failed": 0,
            "p95GenerationMs": 900,
            "meanRealTimeFactor": 0.4,
            "samples": [{"ok": True, "automatedChecks": {"decodable": True, "clippedSampleRatio": 0.0}}],
            "humanRatings": {"naturalnessMos": 4.0, "intelligibilityMos": 4.5, "criticalPoiNameErrors": 0},
        }
        self.assertEqual(evaluate_gate(base, thresholds), [])
        slow = {**base, "p95GenerationMs": 9000, "meanRealTimeFactor": 1.5}
        self.assertEqual(evaluate_gate(slow, thresholds), ["p95-generation", "real-time-factor"])
        clipped = {**base, "samples": [{"ok": True, "automatedChecks": {"clippedSampleRatio": 0.2}}]}
        self.assertEqual(evaluate_gate(clipped, thresholds), ["clipping"])
        unrated = {key: value for key, value in base.items() if key != "humanRatings"}
        self.assertEqual(evaluate_gate(unrated, thresholds), ["missing-human-ratings"])
        experimental = {**base, "locale": "fr", "humanRatings": {"naturalnessMos": 3.1, "intelligibilityMos": 3.6}}
        self.assertEqual(evaluate_gate(experimental, thresholds), [])

    def test_export_matches_worker_benchmark_shape(self) -> None:
        document = export_benchmark(HERE, None)
        self.assertEqual(document["schema"], "tts-benchmark-sentences/v1")
        self.assertEqual({s["locale"] for s in document["sentences"]}, {"vi", "en", "fr"})
        for sentence in document["sentences"]:
            self.assertEqual(set(sentence), {"id", "locale", "category", "text"})
        only_fr = export_benchmark(HERE, "fr")["sentences"]
        self.assertTrue(only_fr and all(s["locale"] == "fr" for s in only_fr))
        backend = json.loads((HERE.parents[1] / "config" / "tts-benchmark-sentences.json").read_text(encoding="utf-8"))
        self.assertTrue(set(backend["sentences"][0]) <= {"id", "locale", "category", "text"})


if __name__ == "__main__":
    unittest.main()
