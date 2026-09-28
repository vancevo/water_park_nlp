BEGIN;

DROP FUNCTION IF EXISTS publish_poi_narration(uuid, uuid, timestamptz);
DROP TABLE IF EXISTS poi_narrations;

COMMIT;
