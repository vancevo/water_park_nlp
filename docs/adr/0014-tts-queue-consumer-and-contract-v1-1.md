# ADR 0014 — TTS queue consumer, draft-audio attach and contract v1.1

- Status: Accepted (I02)
- Date: 2026-10-09
- Deciders: Công (backend), coordinator; reviewed against Tú's I01 report
- Related: ADR 0004 (S3 media + reviewed audio), ADR 0008 (worker foundation),
  ADR 0010 (admin TTS job API), ADR 0013 (AI08 ops),
  `docs/runbooks/frontend-i01-integration-report.md` §4,
  `docs/runbooks/backend-i02-integration-fixes.md`

## Context

I01 swapped the admin UI onto the real AI04 endpoints and found that the
backend could not complete a job end to end: no process consumed
`tts_generation_jobs`, the worker overwrote a cancel with its result, generated
bytes were dropped (artifact metadata only), the AI08 kill switch and quota
were never called, create ignored the workflow status, submit was not locked
while a job ran, the API's fallback `modelVersion` matched no worker voice, and
the TTS endpoints documented no errors. ADR 0010 explicitly left "how the
worker claims queued rows" to integration. This ADR closes it and records the
additive contract changes (v1.1).

## Decision

1. **Worker consumes the table.** `apps/worker/src/worker.ts` (`npm run start`)
   runs `TtsJobConsumer`: one sequential dispatcher claims the oldest `queued`
   row with `UPDATE … FROM (SELECT … FOR UPDATE SKIP LOCKED LIMIT 1)`, moving it
   to `running` with `attempts = 0`, `error_code = NULL` and a fresh
   `lease_token` (migration 012). Claimed jobs run concurrently up to the
   quota. A `running` row not updated for `TTS_JOB_STALE_RUNNING_MS` (default
   30 min, must exceed the attempt timeout) is re-claimable, so a crashed
   worker never strands a job; a stale re-claim keeps the attempts already
   spent, so a job that keeps killing workers is dead-lettered with
   `TTS_WORKER_LOST` once they are exhausted instead of looping forever.
2. **Cancel always wins; a superseded claim never writes.** Every worker write
   after the claim is conditional on `status = 'running'` **and** the claim's
   `lease_token` (fencing); the API's cancel and re-enqueue are conditional
   single-statement UPDATEs (`queued/running → cancelled`,
   `failed/cancelled/succeeded → queued`). Neither side overwrites the other,
   and a worker whose job was cancelled → re-queued → claimed again (or
   re-claimed after the stale window) cannot touch the row any more. A cancel
   while synthesizing discards the result at the next checkpoint (before upload
   and in the commit transaction).
3. **Audio is stored and attached to the DRAFT only.** On success the worker
   uploads the WAV to object storage at
   `poi/{poiId}/{locale}/{sha256}.wav` (private, content-addressed, `ContentType`,
   `ChecksumSHA256`, `x-amz-meta-sha256` — exactly what `verifyAudioObject`
   checks at submit) and then, in **one transaction**, marks the job
   `succeeded` (artifact manifest + `objectKey`) and writes `poi_narrations.audio_*`
   plus `audio_generated_by` **only if the narration is still `draft` and its
   transcript hash still equals the job's**. Otherwise the job fails with
   `TTS_NARRATION_NOT_DRAFT` / `TTS_TRANSCRIPT_STALE`. Nothing is ever published;
   the existing submit → review → approve gate (ADR 0004) is unchanged.
   `rights_owner` comes from `TTS_AUDIO_RIGHTS_OWNER`; `rights_source` names the
   provider/model/version/voice/job; `usage_rights` carries the voice license
   and "draft only; requires human review".
4. **Server-side review gate.** While a narration has a `queued`/`running` job,
   `submit` and `PATCH` answer `409 TTS_JOB_IN_PROGRESS` (the worker may write
   the audio columns). Create requires a `draft` narration
   (`409 NARRATION_NOT_DRAFT`) and at most one active job per narration
   (`409 TTS_JOB_IN_PROGRESS`).
5. **AI08 wired.** `TTS_GENERATION_ENABLED=false` → API create
   `503 AI_FEATURE_DISABLED` (poll/cancel still work) and the worker stops
   claiming (in-flight jobs finish). Quota: API per-user fixed window
   (`TTS_QUOTA_WINDOW_MS`/`TTS_QUOTA_MAX_PER_WINDOW`, `429 rate_limited`, per
   API process), API backlog cap on queued+running rows (`TTS_QUEUE_MAX_ACTIVE`,
   `429 concurrency_limited`), worker `QuotaGuard` for claim rate and
   concurrency (`TTS_QUOTA_MAX_CONCURRENT`). Codes are the `QuotaDecision`
   reasons the admin UI already maps. Worker metrics (`TtsMetrics`) are recorded
   in-process; an HTTP scrape endpoint is still deferred (ADR 0013).
6. **One voice source of truth.** API and worker read the same manifest
   (`TTS_VOICES_MANIFEST_PATH`; Piper `{voices}` or CLI `{entries}` format) so
   the API stamps the per-locale `provider/model/modelVersion` the worker serves
   (same idempotency key). Without a manifest `TTS_DEFAULT_*` apply to every
   locale. A job whose stamp matches no worker voice fails fast with
   `TTS_MODEL_UNAVAILABLE` instead of staying queued; a manifest without a voice
   for the locale (or a mismatching provider/model override) is rejected at
   create with `400 TTS_VOICE_UNAVAILABLE`.
7. **Error codes only on failed jobs.** A `running` job never exposes a
   previous attempt's code; the public job carries `errorCode` only when
   `failed`. New stable job codes: `TTS_STORAGE_ERROR`, `TTS_MODEL_UNAVAILABLE`,
   `TTS_NARRATION_NOT_DRAFT`, `TTS_TRANSCRIPT_STALE`.
8. **Narration ids accept any UUID version** on admin narration/TTS routes
   (seeded narrations use md5-derived ids). POI routes keep v4.

## Contract v1.1 (additive; v1 consumers unchanged)

- `TtsGenerationJob.artifact?: TtsJobArtifactSummary` (`voiceId, license,
  audioSha256, sizeBytes, durationSeconds, sampleRateHz, mimeType`) — only on
  `succeeded`. No object key, no URL.
- `GET /v1/admin/narrations/{narrationId}/tts-jobs/latest` →
  `LatestTtsJobResponse { job: TtsGenerationJob | null }` (EDITOR/REVIEWER/ADMIN).
- `GET /v1/admin/narrations/{id}/audio/playback` → `NarrationAudioPlayback
  { playbackUrl, playbackExpiresAt }` (10-minute signed GET, any workflow
  status, EDITOR/REVIEWER/ADMIN; `404 NARRATION_AUDIO_NOT_FOUND`,
  `503 MEDIA_STORAGE_UNAVAILABLE`).
- `AdminNarration.audioGeneratedBy?: NarrationAudioGeneratedBy` (`provider,
  model, modelVersion, voiceId, license, jobId, generatedAt`) — response-only;
  kept on transcript-only edits, dropped when the audio is replaced/removed.
- OpenAPI documents 400/401/403/404/409/429/503 (+ codes) for the TTS routes and
  409 on submit/PATCH. `info.version` 0.1.0 → 0.1.1. Shared types and
  `DamSenApiClient.getLatestTtsJob` / `getAdminNarrationAudioPlayback` added.

Required v1 fields, statuses, routes and status codes are unchanged. Consumers
must tolerate new optional fields and new `errorCode` values (already true for
the admin UI's mapping).

## Persistence

Migration `012_tts_draft_audio_provenance` (additive, reversible): nullable
`poi_narrations.audio_generated_by jsonb`, a check that it is null without
audio, `tts_generation_jobs.lease_token uuid` (claim fencing token, never
exposed by the API) and a partial index on queued jobs. Down drops them
(provenance of already-attached AI audio is lost on rollback; the audio
columns stay; the I02 worker must be rolled back with it).

## Consequences

- The pipeline is runnable end to end: API → Postgres → worker → S3 → draft →
  human review → publish.
- The API now depends on the TTS job repository inside `NarrationService`
  (same module) for the submit/PATCH lock.
- A job cancelled/superseded after upload, or one that fails the commit-time
  draft/transcript check, leaves an unreferenced, content-addressed object
  (as does an editor replacing AI audio). ADR 0004 reserves deletion for an
  audited lifecycle job that is **not implemented yet**, so such objects
  accumulate until it exists (small: one WAV per discarded run).
- A `succeeded` job is only an idempotent answer while the draft still carries
  its audio (`audioGeneratedBy.jobId` + sha256); otherwise create re-queues the
  same row, so "succeeded" never claims audio that was since replaced.
- Local smoke used an S3 **emulator** (moto) because MinIO images/binaries are
  not reachable here (B03). moto does not enforce presigned signatures or
  `x-amz-checksum-sha256`, so real MinIO/S3 remains required for I04.

## Amendment 2026-10-09 (I04) — contract v1.2, additive

- `PoiNarration.audio.generatedBy?: PublicNarrationAudioProvenance`
  (`provider, model, modelVersion, voiceId, license, generatedAt`) — the
  public narration now says when the **published** audio was generated by a
  TTS job, so visitor clients can label it "AI-generated" (I03 report §5). It
  is copied from `poi_narrations.audio_generated_by` at read time, survives
  review/approve unchanged, and is absent for editor-uploaded audio. The
  internal `jobId` is not exposed publicly. `info.version` 0.1.1 → 0.1.2;
  `PublicNarrationAudioProvenance` added to shared types/API client.
- Narration and TTS job id path params are validated by shape only
  (8-4-4-4-12 hex), not RFC 4122 version/variant bits, because seeded
  narration ids are md5-derived (I02-9 relaxed only the version nibble). POI
  ids keep the v4 check. Values are always bound as SQL parameters.
- Visitor UI does not render the label yet (frontend follow-up for Tú); v1
  and v1.1 consumers are unaffected.

## Amendment 2026-10-10 (C04) — contract v1.3, additive

- `TtsJobArtifactSummary.mimeType` (job `artifact`) widens from `audio/wav` to
  `audio/wav | audio/mpeg | audio/mp4`. With `TTS_AUDIO_RELEASE_FORMAT=mp3|m4a`
  the worker encodes the validated WAV (ADR 0009 §4) and the artifact's
  `audioSha256`/`sizeBytes`/`mimeType` describe the **stored, attached** file,
  so the "draft still carries this job's audio" check (sha256 + jobId) keeps
  working. `durationSeconds`/`sampleRateHz` come from the WAV intermediate.
  Objects are `poi/{poiId}/{locale}/{sha256}.{wav|mp3|m4a}`, matching the
  API's MIME → extension map; draft audio MIME types were already allowed by
  migration 006. An encoder failure is reported as the existing
  `TTS_AUDIO_INVALID` (no new error code). `info.version` 0.1.2 → 0.1.3.
- Default `wav` changes nothing for existing deployments or consumers that only
  ever saw `audio/wav`.
