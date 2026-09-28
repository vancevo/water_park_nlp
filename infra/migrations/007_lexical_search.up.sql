BEGIN;

CREATE EXTENSION IF NOT EXISTS unaccent;
CREATE EXTENSION IF NOT EXISTS pg_trgm;

-- The dictionary is fixed for this project. Wrapping unaccent as immutable lets
-- PostgreSQL use the same normalization expression in functional indexes.
CREATE OR REPLACE FUNCTION search_normalize(input text)
RETURNS text
LANGUAGE sql
IMMUTABLE
PARALLEL SAFE
RETURN lower(unaccent('unaccent', coalesce(input, '')));

CREATE INDEX poi_translations_search_fts_idx
  ON poi_translations USING gin (
    to_tsvector(
      'simple',
      search_normalize(name || ' ' || short_description || ' ' || long_description)
    )
  );

CREATE INDEX poi_translations_name_trgm_idx
  ON poi_translations USING gin (search_normalize(name) gin_trgm_ops);

COMMIT;
