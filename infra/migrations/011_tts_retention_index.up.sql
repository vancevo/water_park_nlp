BEGIN;

-- Backend/infra hardening (AI08): support retention scans over terminal TTS
-- jobs. The retention policy selects jobs by status + age (updated_at), so a
-- composite index keeps the periodic cleanup query off a sequential scan.
-- Additive and reversible; no data change.

CREATE INDEX IF NOT EXISTS tts_generation_jobs_retention_idx
  ON tts_generation_jobs (status, updated_at);

COMMIT;
