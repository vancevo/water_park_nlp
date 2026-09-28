BEGIN;

CREATE TABLE poi_narrations (
  id uuid PRIMARY KEY,
  poi_id uuid NOT NULL REFERENCES pois(id) ON DELETE CASCADE,
  locale varchar(5) NOT NULL CHECK (locale IN ('vi', 'en')),
  revision integer NOT NULL CHECK (revision > 0),
  transcript text NOT NULL CHECK (char_length(transcript) BETWEEN 20 AND 20000),
  workflow_status varchar(20) NOT NULL CHECK (
    workflow_status IN ('draft', 'pending_review', 'published', 'rejected', 'superseded')
  ),
  audio_object_key text,
  audio_mime_type varchar(100),
  audio_size_bytes bigint,
  audio_sha256 char(64),
  audio_duration_seconds numeric(8, 3),
  rights_owner text,
  rights_source text,
  usage_rights text,
  created_by uuid REFERENCES users(id),
  reviewed_by uuid REFERENCES users(id),
  rejection_reason text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  reviewed_at timestamptz,
  published_at timestamptz,
  UNIQUE (poi_id, locale, revision),
  CHECK (
    (audio_object_key IS NULL AND audio_mime_type IS NULL AND audio_size_bytes IS NULL
      AND audio_sha256 IS NULL AND audio_duration_seconds IS NULL AND rights_owner IS NULL
      AND rights_source IS NULL AND usage_rights IS NULL)
    OR
    (audio_object_key IS NOT NULL AND audio_mime_type IN ('audio/mpeg', 'audio/mp4', 'audio/ogg', 'audio/wav')
      AND audio_size_bytes BETWEEN 1 AND 52428800
      AND audio_sha256 ~ '^[0-9a-f]{64}$'
      AND audio_duration_seconds > 0 AND audio_duration_seconds <= 1800
      AND char_length(rights_owner) > 0 AND char_length(rights_source) > 0
      AND char_length(usage_rights) > 0)
  )
);

CREATE UNIQUE INDEX poi_narrations_one_pending_idx
  ON poi_narrations (poi_id, locale) WHERE workflow_status = 'pending_review';
CREATE UNIQUE INDEX poi_narrations_one_published_idx
  ON poi_narrations (poi_id, locale) WHERE workflow_status = 'published';
CREATE INDEX poi_narrations_admin_idx
  ON poi_narrations (poi_id, locale, revision DESC);

-- Publish and supersede execute inside one database statement so the partial
-- unique index can never observe two published revisions for a locale.
CREATE FUNCTION publish_poi_narration(
  target_id uuid,
  reviewer_id uuid,
  reviewed_time timestamptz
) RETURNS void LANGUAGE plpgsql AS $$
DECLARE
  target_poi_id uuid;
  target_locale varchar(5);
BEGIN
  SELECT poi_id, locale INTO target_poi_id, target_locale
  FROM poi_narrations
  WHERE id = target_id AND workflow_status = 'pending_review'
  FOR UPDATE;

  IF target_poi_id IS NULL THEN
    RAISE EXCEPTION 'Narration is not pending review';
  END IF;

  UPDATE poi_narrations
  SET workflow_status = 'superseded', updated_at = reviewed_time
  WHERE poi_id = target_poi_id AND locale = target_locale
    AND workflow_status = 'published';

  UPDATE poi_narrations
  SET workflow_status = 'published', reviewed_by = reviewer_id,
    rejection_reason = NULL, reviewed_at = reviewed_time,
    published_at = reviewed_time, updated_at = reviewed_time
  WHERE id = target_id;
END;
$$;

-- The existing POI seed is explicitly synthetic. Its descriptions provide a
-- deterministic text-only narration fixture; no third-party audio is bundled.
INSERT INTO poi_narrations (
  id, poi_id, locale, revision, transcript, workflow_status, published_at
)
SELECT md5(t.poi_id::text || ':' || t.locale || ':narration')::uuid,
  t.poi_id, t.locale, 1, t.long_description, 'published', now()
FROM poi_translations t
JOIN pois p ON p.id = t.poi_id
WHERE p.source = 'synthetic_fixture';

COMMIT;
