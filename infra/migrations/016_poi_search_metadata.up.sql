BEGIN;

CREATE TABLE poi_search_metadata (
  poi_id uuid NOT NULL REFERENCES pois(id) ON DELETE CASCADE,
  locale varchar(35) NOT NULL CHECK (
    char_length(locale) BETWEEN 2 AND 35
    AND locale ~ '^[A-Za-z]{2,3}(-[A-Za-z0-9]{2,8})*$'
  ),
  aliases text[] NOT NULL DEFAULT '{}',
  activities text[] NOT NULL DEFAULT '{}',
  attributes text[] NOT NULL DEFAULT '{}',
  audiences text[] NOT NULL DEFAULT '{}',
  intent_phrases text[] NOT NULL DEFAULT '{}',
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (poi_id, locale),
  CHECK (cardinality(aliases) <= 20),
  CHECK (cardinality(activities) <= 20),
  CHECK (cardinality(attributes) <= 20),
  CHECK (cardinality(audiences) <= 20),
  CHECK (cardinality(intent_phrases) <= 20)
);

COMMIT;
