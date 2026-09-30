BEGIN;

-- Configurable narration locales (C02 / T25B).
-- Widen poi_narrations.locale from a vi/en-only column to any configured BCP 47
-- code. Additive and backward compatible: existing vi/en rows keep their bytes,
-- the (poi_id, locale, revision) unique key and the partial published/pending
-- indexes are preserved by the in-place type change.

ALTER TABLE poi_narrations
  DROP CONSTRAINT IF EXISTS poi_narrations_locale_check;

ALTER TABLE poi_narrations
  ALTER COLUMN locale TYPE varchar(35);

-- Replace the vi/en allow-list with a minimal BCP 47 form check. Enabled-ness is
-- enforced by the API config loader and write boundaries, not by the database.
ALTER TABLE poi_narrations
  ADD CONSTRAINT poi_narrations_locale_format_check
  CHECK (
    char_length(locale) BETWEEN 2 AND 35
    AND locale ~ '^[A-Za-z]{2,3}(-[A-Za-z0-9]{2,8})*$'
  );

-- The publish/supersede routine pinned the locale type; widen it to match so a
-- longer code is not silently truncated inside the transaction.
CREATE OR REPLACE FUNCTION publish_poi_narration(
  target_id uuid,
  reviewer_id uuid,
  reviewed_time timestamptz
) RETURNS void LANGUAGE plpgsql AS $$
DECLARE
  target_poi_id uuid;
  target_locale varchar(35);
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
