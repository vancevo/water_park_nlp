BEGIN;

-- I02: the TTS worker consumes queued jobs and attaches generated audio to the
-- DRAFT narration only (ADR 0004 review gate; ADR 0014). Additive and
-- reversible: one nullable column, one check and one partial index.

-- AI provenance of the narration's CURRENT audio: provider, model, modelVersion,
-- voiceId, license, jobId, generatedAt. NULL for editor-uploaded audio. Never
-- contains transcript text or audio bytes.
ALTER TABLE poi_narrations
  ADD COLUMN IF NOT EXISTS audio_generated_by jsonb;

ALTER TABLE poi_narrations
  ADD CONSTRAINT poi_narrations_audio_generated_by_requires_audio
  CHECK (audio_generated_by IS NULL OR audio_object_key IS NOT NULL);

-- Worker claim scan: oldest queued job first (FOR UPDATE SKIP LOCKED).
CREATE INDEX IF NOT EXISTS tts_generation_jobs_queued_idx
  ON tts_generation_jobs (updated_at) WHERE status = 'queued';

COMMIT;
