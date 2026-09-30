BEGIN;

-- Rollback guard: refuse to narrow the column while data would be lost. Only
-- roll back when every narration is still vi/en and <= 5 chars.
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM poi_narrations
    WHERE char_length(locale) > 5 OR locale NOT IN ('vi', 'en')
  ) THEN
    RAISE EXCEPTION
      'Cannot roll back 009: narrations exist with locales other than vi/en; '
      'disable and remove non-vi/en narrations before rolling back';
  END IF;
END $$;

ALTER TABLE poi_narrations
  DROP CONSTRAINT IF EXISTS poi_narrations_locale_format_check;

ALTER TABLE poi_narrations
  ALTER COLUMN locale TYPE varchar(5);

ALTER TABLE poi_narrations
  ADD CONSTRAINT poi_narrations_locale_check CHECK (locale IN ('vi', 'en'));

CREATE OR REPLACE FUNCTION publish_poi_narration(
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

COMMIT;
