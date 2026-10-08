# ADR 0010 — Admin TTS job API

- Status: Accepted (AI04)
- Date: 2026-10-02
- Deciders: Công (backend), coordinator
- Related: `docs/plans/AI_TTS_AND_TRAINING_ROADMAP.md`, ADR 0007, ADR 0008, ADR 0009

## Context

ADR 0008/0009 built the provider-neutral TTS worker and the Piper baseline, but
left the admin surface for AI04: the endpoints an EDITOR/ADMIN uses to request TTS
audio for a reviewed narration and to poll/cancel that work. The public contract
(`/v1/admin/narrations/{id}/tts-jobs`, `/v1/admin/tts-jobs/{id}`, `.../cancel`,
`CreateTtsJobRequest`, `TtsGenerationJob`) was locked in C01 and must not change.
The API runs in the request process; synthesis is heavy and offline, so the API
must not synthesize.

## Decision

1. **The API enqueues; the worker synthesizes.** A create request validates and
   writes a `queued` row to the shared `tts_generation_jobs` table (migration
   010), then returns it (`202`). Running, retrying, dead-lettering and the
   artifact manifest stay entirely in the worker (C03). The API never writes an
   artifact and never marks a narration published — **output is a draft only, no
   auto-approve.**
2. **Write boundaries.** Create requires: the narration exists (`404` otherwise);
   the requested locale is an enabled catalog locale (`400 NARRATION_LOCALE_DISABLED`,
   reusing `NarrationLocalesService.requireEnabled` from C02) and equals the
   narration's own locale (`400 TTS_JOB_LOCALE_MISMATCH`); and the transcript is
   non-empty (`400 TTS_JOB_TRANSCRIPT_EMPTY`).
3. **RBAC.** Controller guards (`AccessTokenGuard` + `RolesGuard`): create and
   cancel require `EDITOR`/`ADMIN`; poll allows `EDITOR`/`REVIEWER`/`ADMIN`.
   Visitors get `403`, unauthenticated callers `401`. No visitor path can create.
4. **Idempotent enqueue.** The idempotency key is `narrationId:transcriptHash:
   modelVersion` (same definition as the worker). A duplicate request for a
   queued/running/succeeded job returns it unchanged; a previously failed or
   cancelled job re-enqueues in place (same row reset to `queued`), respecting the
   table's unique key.
5. **Enqueue metadata.** `provider`/`model` come from the request or from
   `TTS_DEFAULT_PROVIDER`/`TTS_DEFAULT_MODEL`; `modelVersion` from
   `TTS_DEFAULT_MODEL_VERSION` (`loadTtsJobDefaults`). These defaults must match
   the worker's configured provider in a deployment; the worker reconciles the
   pinned model version when it runs the job (finalized in integration/AI05).
6. **Privacy.** A job record carries only the normalized transcript hash and a
   stable error code — never transcript text or audio bytes.

## Boundary (deferred to integration/AI05)

How the worker claims queued rows (poller vs. direct invocation) is not decided
here; the worker's `generate()` currently treats an existing non-failed row as
in-flight. The enqueue/worker reconciliation (claiming + matching the real pinned
`modelVersion`) is closed in integration (I01) / AI05.

## Consequences

- The admin API has no heavy dependency and cannot block on synthesis.
- The API owns a small `TtsJobRepository` (in-memory + Postgres) targeting the
  worker's table; `tts-hash.ts` duplicates the worker's ~10-line hashing because
  the self-contained worker workspace cannot be imported by the API. Keep the two
  in sync.
- HTTP tests boot the app and run in CI (Node 24); service-level validation and
  idempotency are covered by Node-agnostic unit tests.
