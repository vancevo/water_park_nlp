# Runbook — Piper TTS baseline (backend)

Install Piper, download pinned voices and run the CPU benchmark (C04 / AI03).
Native binary only — **Docker is not required** (keeps the footprint ~150 MB).
See ADR 0009 and `docs/plans/AI_TTS_AND_TRAINING_ROADMAP.md`.

## 1. Install the Piper binary

- Download a Piper release for your OS from the engine repo
  (`https://github.com/OHF-Voice/piper1-gpl`) and put `piper` on your PATH, or set
  an absolute `binaryPath` in the voice manifest.
- Check it runs: `piper --help`.

## 2. Set licenses + download voices

1. Open `config/tts-voices.example.json`. For each voice, replace the `license`
   placeholder with the real license from that voice's MODEL CARD on
   `https://huggingface.co/rhasspy/piper-voices`. (The setup script refuses to run
   while a placeholder/empty license remains.)
2. Run the setup from the repo root:

   ```
   npm run tts:setup-voices
   ```

   It downloads each pinned `.onnx` (+ its `.json`) into `config/piper-voices/`
   (gitignored), computes the sha256 and writes `config/tts-voices.json` with real
   checksums. Review it, then commit `config/tts-voices.json`.

Disk: the Piper binary is ~30 MB and each medium voice ~60 MB — ~150 MB total for
VI + EN.

## 3. Run the CPU benchmark

```
npm run benchmark --workspace @damsen/worker
```

Writes `config/tts-benchmark-report.json` (gitignored) with, per voice:

- `meanRealTimeFactor` — generation seconds per audio second (lower is faster;
  < 1 means faster than real time).
- `p50GenerationMs` / `p95GenerationMs` — generation time percentiles.
- `totalSizeBytes` and per-sentence `samples` (ids only — no transcript/audio).

Use it to confirm a voice is usable on your CPU and to compare settings
(`lengthScale`, voice quality). The sentence set is
`config/tts-benchmark-sentences.json` (backend fixture; the full corpus is Tú's
AI01).

## 4. Add or change a voice

1. Add an entry to `config/tts-voices.json` (or the example) with `provider:
   "piper"`, a pinned `modelVersion`, the `locale`, `sourceUrl`, `license`, a
   `modelPath` under `config/piper-voices/`, and `enabled`.
2. Re-run `npm run tts:setup-voices` to download and checksum it.
3. The voice becomes available to the generation service via the model registry
   for its locale (the locale must also be enabled in the narration locale catalog
   — see `backend-narration-locales.md`).

## Privacy and safety

- No transcript, prompt or audio is logged; the benchmark report stores only ids,
  timings and sizes.
- Each voice records license + source + checksum for provenance; never infer a
  voice license from the engine license.
- No voice cloning without written consent and explicit rights (roadmap §3).

## Notes

- CI does not run Piper (no engine/GPU); it verifies the adapter via a mocked
  runner. Synthesis and benchmarking happen on your machine.
- WAV is the baseline output. Encoding to mp3/m4a for release is a later task.
