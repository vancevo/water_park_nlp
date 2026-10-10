# ADR 0009 — Piper TTS baseline

- Status: Accepted (C04 / AI03)
- Date: 2026-10-01
- Deciders: Công (backend), coordinator
- Related: `docs/plans/AI_TTS_AND_TRAINING_ROADMAP.md`, ADR 0008, ADR 0007

## Context

ADR 0008 established a provider-neutral TTS foundation (`TtsProvider`). We now need
a real baseline engine for VI/EN narration audio. Constraints: it must run on CPU,
stay out of the API process, be reproducible and licensed per artifact — and it
must be installable on a developer machine with little free disk (~3 GB).

## Decision

1. **Piper via native binary, not Docker.** The baseline uses the pinned Piper
   executable run in an isolated child process (`PiperTtsProvider`). Docker is
   intentionally avoided for the baseline: Docker Desktop + a base image would
   dwarf the ~150 MB the native binary and two medium voices need. A container
   remains a later option.
2. **Pinned voices in a manifest.** `config/tts-voices.json` lists each voice with
   `model`, immutable `modelVersion`, `voiceId`, `locale`, `license`, `sourceUrl`,
   `checksum` and local `modelPath`. `config/tts-voices.example.json` is the
   committed template; `scripts/setup-piper-voices.mjs` downloads the pinned
   voices, computes the sha256 and writes the real manifest (committed with
   checksums). Voice `.onnx` binaries live in `config/piper-voices/` and are
   gitignored — Git keeps only the manifest and checksums.
3. **License per voice, enforced.** The setup script refuses to run while any
   voice license is unset/placeholder; licenses are taken from each voice MODEL
   CARD, never inferred from the engine repository (Piper's engine is GPL; voices
   vary).
4. **WAV intermediate.** The provider returns the WAV Piper produces and derives
   duration/sample rate from the container. Encoding to a smaller release format
   (mp3/m4a) is deferred (P1). **Amended 2026-10-10 (C04):** the worker can
   encode the validated WAV to mp3/m4a with ffmpeg
   (`TTS_AUDIO_RELEASE_FORMAT`, default `wav`) inside the same per-attempt
   timeout; the stored/attached file, its sha256 and the job artifact describe
   the encoded bytes (contract v1.3, ADR 0014 amendment).
5. **CPU benchmark.** `runTtsBenchmark` measures real-time factor, p50/p95
   generation time and output size over a small backend-owned sentence fixture
   (`config/tts-benchmark-sentences.json`); the full corpus is Tú's AI01. The
   report (`config/tts-benchmark-report.json`, gitignored) records only sentence
   ids, timings and sizes — never transcript or audio.
6. **Cancellation/timeouts.** The default runner enforces a per-process timeout
   and kills the child on expiry; the C03 service adds its own timeout/retry.

## Out of scope (follow-ups)

- Release-format encoding and perceptual audio checks (clipping/silence) — P1.
- ZeroTTS/MOSS comparison — AI05; GPU and fine-tuning — AI06.
- Admin "generate audio" endpoints/UI — AI04.

## Consequences

- Actual synthesis and the benchmark run on a developer machine with Piper
  installed; CI verifies the adapter via a mocked runner (no engine/GPU in CI).
- Adding a locale voice is a manifest edit + `setup-piper-voices` run; the voice
  is then available to the C03 generation service through the registry.
- Model binaries and benchmark reports never enter Git — only manifests, licenses
  and checksums.
