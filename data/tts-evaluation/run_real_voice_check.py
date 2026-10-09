#!/usr/bin/env python3
"""Run the T06 corpus through the real Piper voices and write a report + blind-review package.

    python3 data/tts-evaluation/run_real_voice_check.py --out /path/to/outdir

Needs `piper` on PATH and config/tts-voices.json (npm run tts:setup-voices).
Writes into --out (never into the repo):
  report.json          tts-evaluation-report/v1, no human ratings => every gate
                       fails with `missing-human-ratings` until raters score it
  review/B###.wav      audio under opaque labels, shuffled across locales
  review/labels.json   label -> {locale, sampleId, text}; NO provider/voice
  review-key.json      label -> provider/model/voiceId (keep away from raters)
Transcripts are in labels.json for raters; the report holds only ids and numbers.
"""

import argparse
import array
import json
import random
import statistics
import subprocess
import sys
import tempfile
import time
import wave
from datetime import datetime, timezone
from pathlib import Path

HERE = Path(__file__).resolve().parent
ROOT = HERE.parents[1]
sys.path.insert(0, str(HERE))
import validate  # noqa: E402

FRAME_SECONDS = 0.01
SILENCE_LEVEL = 0.01  # fraction of full scale


def wav_checks(path: Path) -> dict:
    with wave.open(str(path), "rb") as handle:
        rate = handle.getframerate()
        width = handle.getsampwidth()
        channels = handle.getnchannels()
        frames = handle.readframes(handle.getnframes())
    if width != 2:
        return {"decodable": False}
    samples = array.array("h")
    samples.frombytes(frames)
    if channels > 1:
        samples = samples[::channels]
    total = len(samples)
    if total == 0:
        return {"decodable": False}
    clipped = sum(1 for s in samples if abs(s) >= 32767 * 0.999) / total
    size = max(1, int(rate * FRAME_SECONDS))
    silent = [
        max(abs(s) for s in samples[i : i + size]) < 32768 * SILENCE_LEVEL
        for i in range(0, total, size)
    ]
    lead = next((i for i, quiet in enumerate(silent) if not quiet), len(silent))
    tail = next((i for i, quiet in enumerate(reversed(silent)) if not quiet), len(silent))
    inner = silent[lead : len(silent) - tail]
    return {
        "decodable": True,
        "clippedSampleRatio": round(clipped, 6),
        "leadingSilenceSeconds": round(lead * FRAME_SECONDS, 3),
        "trailingSilenceSeconds": round(tail * FRAME_SECONDS, 3),
        "internalSilenceRatio": round(sum(inner) / len(inner), 4) if inner else 0.0,
        "_duration": total / rate,
    }


def percentile(values: list[int], pct: float) -> int:
    ordered = sorted(values)
    return ordered[min(len(ordered) - 1, int(round(pct * (len(ordered) - 1))))]


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--out", required=True)
    parser.add_argument("--seed", type=int, default=20261009)
    args = parser.parse_args()
    out = Path(args.out)
    review = out / "review"
    review.mkdir(parents=True, exist_ok=True)

    voices = json.loads((ROOT / "config/tts-voices.json").read_text())
    by_locale = {v["locale"]: v for v in voices["voices"] if v.get("enabled")}
    thresholds = json.loads((HERE / "thresholds.json").read_text())

    with tempfile.TemporaryDirectory() as tmp:
        export = Path(tmp) / "sentences.json"
        subprocess.run(
            [sys.executable, str(HERE / "validate.py"), "--export-benchmark", str(export)],
            check=True,
            capture_output=True,
        )
        sentences = json.loads(export.read_text())["sentences"]

    reports, items = [], []
    for locale in sorted(by_locale):
        voice = by_locale[locale]
        samples, times, sizes, rtfs = [], [], 0, []
        for sentence in (s for s in sentences if s["locale"] == locale):
            wav = out / "raw" / f"{sentence['id']}.wav"
            wav.parent.mkdir(exist_ok=True)
            started = time.perf_counter()
            run = subprocess.run(
                [voices.get("binaryPath", "piper"), "--model", str(ROOT / voice["modelPath"]),
                 "--output_file", str(wav)],
                input=sentence["text"].encode(),
                capture_output=True,
            )
            elapsed_ms = round((time.perf_counter() - started) * 1000)
            ok = run.returncode == 0 and wav.exists()
            checks = wav_checks(wav) if ok else {"decodable": False}
            duration = checks.pop("_duration", None)
            rtf = round(elapsed_ms / 1000 / duration, 3) if duration else None
            sample = {
                "id": sentence["id"], "category": sentence["category"], "ok": ok and checks["decodable"],
                "generationMs": elapsed_ms, "durationSeconds": round(duration, 2) if duration else 0,
                "realTimeFactor": rtf, "sizeBytes": wav.stat().st_size if ok else 0,
                "automatedChecks": checks,
            }
            samples.append(sample)
            times.append(elapsed_ms)
            sizes += sample["sizeBytes"]
            if rtf is not None:
                rtfs.append(rtf)
            if sample["ok"]:
                items.append((locale, sentence, wav, voice))
        report = {
            "provider": voice["provider"], "model": voice["model"], "modelVersion": voice["modelVersion"],
            "voiceId": voice["voiceId"], "locale": locale, "count": len(samples),
            "ok": sum(s["ok"] for s in samples), "failed": sum(not s["ok"] for s in samples),
            "p50GenerationMs": percentile(times, 0.5), "p95GenerationMs": percentile(times, 0.95),
            "meanRealTimeFactor": round(statistics.fmean(rtfs), 5) if rtfs else None,
            "totalSizeBytes": sizes, "samples": samples,
            "generatedAt": datetime.now(timezone.utc).isoformat(timespec="milliseconds").replace("+00:00", "Z"),
        }
        failures = validate.evaluate_gate(report, thresholds)
        report["gate"] = {"passed": not failures, "failures": failures}
        reports.append(report)

    data = json.loads((HERE / "manifest.json").read_text())
    corpus = {"datasetId": data.get("datasetId", "damsen-tts-eval"), "version": data.get("version", "1.0.0"),
              "thresholdsVersion": thresholds["version"]}
    (out / "report.json").write_text(json.dumps({
        "schema": "tts-evaluation-report/v1", "fixture": False,
        "note": "Real Piper voices on CPU over the full T06 corpus. Operational + automated checks only: "
                "no human ratings yet, so every gate fails with missing-human-ratings by design.",
        "corpus": corpus, "reports": reports}, indent=2, ensure_ascii=False) + "\n")

    random.Random(args.seed).shuffle(items)
    labels, key = {}, {}
    for index, (locale, sentence, wav, voice) in enumerate(items, start=1):
        label = f"B{index:03d}"
        (review / f"{label}.wav").write_bytes(wav.read_bytes())
        labels[label] = {"locale": locale, "sampleId": sentence["id"], "category": sentence["category"],
                         "text": sentence["text"]}
        key[label] = {"provider": voice["provider"], "model": voice["model"], "voiceId": voice["voiceId"]}
    (review / "labels.json").write_text(json.dumps(labels, indent=2, ensure_ascii=False) + "\n")
    (out / "review-key.json").write_text(json.dumps(key, indent=2) + "\n")
    print(f"wrote {out}: {sum(r['ok'] for r in reports)}/{sum(r['count'] for r in reports)} ok")


if __name__ == "__main__":
    main()
