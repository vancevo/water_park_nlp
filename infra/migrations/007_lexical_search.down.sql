BEGIN;

DROP INDEX IF EXISTS poi_translations_name_trgm_idx;
DROP INDEX IF EXISTS poi_translations_search_fts_idx;
DROP FUNCTION IF EXISTS search_normalize(text);

-- Extensions are intentionally retained: another feature may use them.
COMMIT;
