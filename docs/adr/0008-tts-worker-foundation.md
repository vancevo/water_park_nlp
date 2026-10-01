# ADR 0008 — TTS worker foundation

- Status: Accepted (C03 / AI02)
- Date: 2026-10-01
- Deciders: Công (backend), coordinator
- Related: `docs/plans/AI_TTS_AND_TRAINING_ROADMAP.md`,
  `docs/plans/CONG_TU_WORK_SPLIT.md`, ADR 0004, ADR 0007

## Context

The project needs AI-assisted narration audio: generate a draft from an approved
transcript, which an editor reviews and a reviewer publishes. Nothing exists yet —
no provider abstraction, job queue, model registry, retry/dead-letter or audio
validation. We need the reusable, provider-neutral foundation before adopting any
concrete engine (Piper arrives in AI03) and before the admin API/UI (AI04).

AI must never auto-publish, must be reproducible, and must never leak transcript,
prompt or audio into logs (roadmap §3).

## Decision

1. **Provider port.** The domain depends only on a `TtsProvider` interface
   (`provider`, `model`, immutable `modelVersion`, `supportsLocale`, `synthesize`).
   No engine SDK is imported by the domain. Generation runs offline in the worker,
   never inside a visitor request.
2. **Idempotency.** The key is `narrationId + transcriptHash + modelVersion`. A
   duplicate request returns the existing job and never re-synthesizes or
   duplicates an artifact. A succeeded, in-flight, cancelled or dead-lettered job
   is returned as-is; only a non-dead-lettered failure is retried.
3. **Retry / timeout / dead-letter.** Each attempt has a timeout; failures retry
   with exponential backoff up to `maxAttempts`, after which the job is terminal
   (`failed`, `deadLettered = true`) and will not run again on its own.
4. **Model/voice registry.** Each entry carries an explicit `license`, `sourceUrl`
   and pinned `checksum`, an `enabled` flag and a `locale`. `modelVersion` must be
   immutable (never `main`/`latest`). Licenses are never inferred. Locale lookup
   returns only enabled voices.
5. **Reproducible artifact.** A succeeded job stores a manifest: provider, model,
   modelVersion, voiceId, license, configHash, transcriptHash, seed, audioSha256,
   size, duration, sampleRate, mimeType. It contains no transcript text or audio
   bytes.
6. **Audio validation boundary.** Synthesized output is validated (WAV container,
   non-empty, duration range, size, sample rate) before it can become an artifact;
   perceptual checks (clipping/silence) are deferred to AI03.
7. **Fail closed + draft only.** A provider failure only marks the job. The
   service never publishes and never touches an existing published narration; its
   output is a draft artifact for the narration workflow to attach later.
8. **Privacy.** Only stable error codes (`TTS_TIMEOUT`, `TTS_AUDIO_INVALID`,
   `TTS_PROVIDER_ERROR`, …) are persisted. Transcript, prompt and audio never
   enter the job record or logs.
9. **Persistence.** Migration 010 adds `tts_generation_jobs` with a unique
   idempotency key, a `jsonb` artifact manifest, an artifact-state check and a
   dead-letter index. The in-memory repository backs tests and local runs.

## Out of scope (follow-ups)

- Real engine adapter and CPU benchmark — AI03 (Piper).
- Admin generation endpoints, RBAC, polling, preview — AI04.
- Provider comparison and selection — AI05; production hardening — AI08.

## Consequences

- A concrete engine plugs in by implementing `TtsProvider`; the API layer (AI04)
  calls `generate()`/`cancel()` and attaches the resulting draft artifact.
- Retries are safe by construction (idempotency), and licensing is gated at the
  registry rather than inferred.
- Large audio and model checkpoints never enter Git; only manifests and checksums.
