BEGIN;

-- TTS worker foundation (C03 / AI02): persistent, idempotent generation jobs.
-- One artifact per (narration_id, transcript_hash, model_version) via the unique
-- idempotency key. AI output is a draft artifact only — this table never marks a
-- narration published; that stays in the narration workflow.

CREATE TABLE tts_generation_jobs (
  id uuid PRIMARY KEY,
  narration_id uuid NOT NULL REFERENCES poi_narrations(id) ON DELETE CASCADE,
  status varchar(20) NOT NULL CHECK (
    status IN ('queued', 'running', 'succeeded', 'failed', 'cancelled')
  ),
  provider varchar(100) NOT NULL,
  model varchar(200) NOT NULL,
  model_version varchar(200) NOT NULL,
  transcript_hash char(64) NOT NULL CHECK (transcript_hash ~ '^[0-9a-f]{64}$'),
  idempotency_key text NOT NULL,
  attempts integer NOT NULL DEFAULT 0 CHECK (attempts >= 0),
  max_attempts integer NOT NULL CHECK (max_attempts > 0),
  dead_lettered boolean NOT NULL DEFAULT false,
  error_code varchar(80),
  -- Versioned artifact manifest (provider/model/version/hashes/checksum/license).
  -- Never contains transcript text or audio bytes.
  artifact jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT tts_generation_jobs_idempotency_unique UNIQUE (idempotency_key),
  -- A succeeded job must carry an artifact; a non-succeeded job must not.
  CONSTRAINT tts_generation_jobs_artifact_state CHECK (
    (status = 'succeeded' AND artifact IS NOT NULL)
    OR (status <> 'succeeded' AND artifact IS NULL)
  )
);

CREATE INDEX tts_generation_jobs_narration_idx
  ON tts_generation_jobs (narration_id, created_at DESC);
CREATE INDEX tts_generation_jobs_status_idx
  ON tts_generation_jobs (status);
-- Operational view of jobs parked in the dead-letter state.
CREATE INDEX tts_generation_jobs_dead_letter_idx
  ON tts_generation_jobs (updated_at) WHERE dead_lettered;

COMMIT;
