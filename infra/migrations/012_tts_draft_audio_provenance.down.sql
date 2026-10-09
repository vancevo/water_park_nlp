BEGIN;

DROP INDEX IF EXISTS tts_generation_jobs_queued_idx;

ALTER TABLE poi_narrations
  DROP CONSTRAINT IF EXISTS poi_narrations_audio_generated_by_requires_audio;

ALTER TABLE poi_narrations
  DROP COLUMN IF EXISTS audio_generated_by;

COMMIT;
