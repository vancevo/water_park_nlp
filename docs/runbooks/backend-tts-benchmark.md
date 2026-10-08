# Runbook — TTS provider benchmark (backend)

Compare TTS engines on identical inputs and produce the provider decision
record (AI05 / C05). Scope: the benchmark harness + adapters + validator. Real
synthesis runs on your machine; CI only tests the adapters with fake runners.
See ADR 0011 and `docs/plans/AI_TTS_AND_TRAINING_ROADMAP.md` (AI05).

## Where it lives

- Adapter: `apps/worker/src/tts/providers/cli-tts-provider.ts` (`CliTtsProvider`).
- Candidate manifest: `apps/worker/src/tts/providers/benchmark-providers-manifest.ts`
  → `config/tts-benchmark-providers.json` (template: `*.example.json`).
- Harness + validator: `provider-benchmark.ts`, `provider-benchmark-report.ts`.
- CLI: `run-provider-benchmark.ts` → `npm run tts:benchmark-providers`.
- Thresholds (fixed up front): `config/tts-benchmark-thresholds.json`.
- Inputs: `config/tts-benchmark-sentences.json` (backend fixture; the full
  corpus is Tú's AI01 at I03).

## Run it

1. Install each engine you want to compare and download its pinned model weights
   into `config/<engine>/` (gitignored). Candidate sources (pin a commit/tag,
   never `main`): Piper `https://github.com/OHF-Voice/piper1-gpl` +
   `https://huggingface.co/rhasspy/piper-voices`; ZeroTTS
   `https://github.com/zeroweight-ai/ZeroTTS`; MOSS-TTS
   `https://github.com/OpenMOSS/MOSS-TTS`.
2. `cp config/tts-benchmark-providers.example.json config/tts-benchmark-providers.json`
   and, per each engine's MODEL CARD, fill `modelVersion` (pinned), `license`,
   `checksum`, `command`, `argsTemplate`, `modelPath`. License is taken from the
   model/voice card, never inferred from the engine repo.
3. CPU comparison (default critical path):
   `npm run tts:benchmark-providers`
   GPU candidates too (MOSS-TTS): `TTS_BENCHMARK_INCLUDE_GPU=1 npm run tts:benchmark-providers`
4. Read `config/tts-provider-benchmark-report.json` (gitignored). The CLI prints
   per-provider PASS/FAIL vs thresholds and a per-locale recommendation, and
   refuses to write a report that fails the validator.

## Blind review

The report's `blindLabels` map opaque labels (`B001…`) to (provider, locale,
sampleId). Generate the audio named by label, have a native speaker rate
natural-ness / intelligibility / pronunciation without seeing the provider, then
join ratings back by label. Automated metrics (RTF, p95, size, failures) are
operational signals only — they do not decide quality.

## Thresholds and the decision

`config/tts-benchmark-thresholds.json` is fixed before results: `maxP95GenerationMs`,
`maxMeanRealTimeFactor`, `maxFailureRate`, `minLocales`. A provider passes only
if it ran samples and met all of them. The automated recommendation prefers the
fastest passing CPU provider per locale (GPU only if no CPU option passes) and
always names the hardware class and license. Final selection and any GO on
fine-tuning (AI06) happen at integration I03 over the full corpus with blind
review — never from the fixture alone.

## Troubleshooting

- `cannot read manifest …`: copy and fill `config/tts-benchmark-providers.json`.
- `report failed validation`: the CLI lists the violations (e.g. missing
  license, unpinned version, mismatched inputs) — fix the manifest/thresholds.
- A provider shows `ok=0`: its `command`/`modelPath` is wrong or the engine is
  not installed; check it runs standalone first.
- Privacy: the report stores only ids, input hashes, timings and stable error
  codes. Never add transcript text or audio paths to it.
