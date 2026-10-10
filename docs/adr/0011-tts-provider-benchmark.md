# ADR 0011 — TTS provider benchmark and selection

- Status: Accepted (AI05 / C05)
- Date: 2026-10-08
- Deciders: Công (backend), coordinator
- Related: `docs/plans/AI_TTS_AND_TRAINING_ROADMAP.md` (AI05), ADR 0008, ADR 0009

## Context

AI02/AI03 gave us a provider-neutral worker and a Piper CPU baseline. AI05 must
compare candidate engines — Piper, ZeroTTS (VI) and MOSS-TTS (GPU) — on the same
inputs and produce a **provider decision record** with per-locale
recommendations and the hardware/license constraints behind them. Real engines
cannot run in CI (no binaries, no GPU) and the full evaluation corpus is Tú's
AI01 (`data/tts-evaluation/**`), run at integration I03. So AI05 delivers the
reproducible harness + adapters + validator + decision framework; the measured
numbers are produced locally and the rollout/fine-tune GO is a later gate.

## Decision

1. **One shared adapter for new candidates.** Additional engines run through a
   single `CliTtsProvider` (isolated child process, injectable runner,
   timeout/kill, WAV out) driven by a per-engine spec in
   `config/tts-benchmark-providers.json` (command, argsTemplate with
   `{out}/{model}/{text}/{voice}/{speaker}`, stdin flag, pinned version, license,
   source, checksum, `hardwareClass`). Adding a candidate is a config edit, not
   new code. Piper keeps its dedicated adapter and is listed as a candidate too.
2. **Thresholds fixed before results.** `config/tts-benchmark-thresholds.json`
   defines the automated pass gates up front (committed, see the file): p95
   generation time, mean real-time factor, failure rate, minimum locales. The
   harness scores each provider against these; it never derives a gate from the
   numbers.
3. **Identical normalized inputs.** Every provider is fed the NFC + whitespace-
   normalized transcript, and the report stores the sha256 of each normalized
   input so the validator can prove every engine saw exactly the same text.
4. **Blind human review.** Natural-ness and pronunciation are NOT decided by the
   automated metrics (operational only). The report emits a sealed
   provider↔label map (`B001…`) so generated audio can be rated blind.
5. **CPU is the default critical path.** GPU-class candidates (MOSS-TTS) are
   excluded unless `TTS_BENCHMARK_INCLUDE_GPU=1`, keeping the CPU comparison the
   one that gates the MVP.
6. **Report validator.** `validateProviderComparisonReport` enforces: thresholds
   present/sane, identical input set per provider, pinned model versions,
   hardware + license disclosed, failures disclosed, and no transcript text in
   the report. The CLI refuses to write an invalid report.
7. **Recommendation rule.** Per locale, recommend the fastest passing CPU
   provider (GPU only if no CPU option passes); if none pass, recommend keeping
   the current baseline. Every recommendation names the hardware class and
   license. Recommendations are provisional until the full-corpus blind run.

## Pass thresholds (fixed up front)

Values live in `config/tts-benchmark-thresholds.json`: `maxP95GenerationMs`
15000, `maxMeanRealTimeFactor` 2.0, `maxFailureRate` 0.0, `minLocales` 2. These
are the automated gates; the release gate (no regression on published VI/EN,
critical POI-name pronunciation correct) is enforced by blind review at I03.

## Provisional recommendation (pending measured numbers)

Before the local/I03 runs, and on the engines' documented characteristics:
VI and EN start on **Piper** (CPU, permissive per voice, already the baseline);
**ZeroTTS** is evaluated as a VI quality candidate on CPU; **MOSS-TTS** stays off
the CPU critical path and is benchmarked only where a GPU is available. The
measured comparison + blind review at I03 confirm or change this.

## Out of scope / follow-ups

- Production rollout and fine-tuning (AI06) — AI06 opens only if AI05 shows the
  baseline misses the release gate, after a coordinator GO; never train from
  scratch.
- The full evaluation corpus (`data/tts-evaluation/**`, Tú's AI01) replaces the
  small backend fixture at I03.

## Consequences

- Candidates are compared reproducibly with disclosed failures, hardware and
  licenses; no engine or GPU runs in CI (adapters/harness/validator are covered
  by unit tests with fake runners/providers).
- The generated report (`config/tts-provider-benchmark-report.json`) and local
  engine weights are gitignored; only manifests, thresholds and checksums are
  committed.

## Amendment 2026-10-10 — provider decision for the educational demo

Decided by Công for the non-commercial classroom demo (ADR 0015 §6a); human
blind review is waived for this tier only.

**Decision: Piper (CPU) for all three locales — `vi_VN-vais1000-medium` (VI,
the primary visitor language), `en_US-ljspeech-medium` (EN),
`fr_FR-siwis-medium` (FR)**, the voices already pinned with checksums in
`config/tts-voices.json`.

Evidence (I03 real-Piper run over the full 64-sentence T06 corpus,
`data/tts-evaluation/reports/fixtures/i03-real-piper-report.json`):

| Locale | Voice | OK | p95 generation | Mean RTF |
|---|---|---:|---:|---:|
| vi | vi_VN-vais1000-medium | 24/24 | 883 ms | 0.24 |
| en | en_US-ljspeech-medium | 21/21 | 936 ms | 0.19 |
| fr | fr_FR-siwis-medium | 19/19 | 898 ms | 0.19 |

All three pass every automated and operational gate (0 failures, p95 well
under 15 s, real-time factor < 1, i.e. faster than playback); the only failing
item is `missing-human-ratings`, waived for the demo. Why not the others:
`vais1000-medium` is the only *medium*-quality Vietnamese Piper voice (the
alternatives are `low`/`x_low`); ZeroTTS and MOSS-TTS were not run (weights
not reachable from the build environment; MOSS needs a GPU), so by rule 7 the
current passing baseline is kept. Before publication the §6b gate of ADR 0015
(blind review ≥ 3 native raters per locale) applies and may change this.
