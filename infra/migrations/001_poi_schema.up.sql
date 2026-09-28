BEGIN;

CREATE EXTENSION IF NOT EXISTS postgis;

CREATE TABLE poi_categories (
  id uuid PRIMARY KEY,
  slug varchar(50) NOT NULL UNIQUE CHECK (slug ~ '^[a-z][a-z0-9_-]*$'),
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE pois (
  id uuid PRIMARY KEY,
  slug varchar(100) NOT NULL UNIQUE,
  category_id uuid NOT NULL REFERENCES poi_categories(id),
  status varchar(20) NOT NULL CHECK (status IN ('draft', 'pending_review', 'published', 'rejected')),
  location geography(Point, 4326) NOT NULL,
  source varchar(100) NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE poi_translations (
  poi_id uuid NOT NULL REFERENCES pois(id) ON DELETE CASCADE,
  locale varchar(5) NOT NULL CHECK (locale IN ('vi', 'en')),
  name varchar(200) NOT NULL,
  short_description varchar(500) NOT NULL,
  long_description text NOT NULL,
  PRIMARY KEY (poi_id, locale)
);

CREATE TABLE poi_entrances (
  id uuid PRIMARY KEY,
  poi_id uuid NOT NULL REFERENCES pois(id) ON DELETE CASCADE,
  label_vi varchar(200) NOT NULL,
  label_en varchar(200) NOT NULL,
  location geography(Point, 4326) NOT NULL,
  graph_node_ref varchar(100) NOT NULL,
  is_primary boolean NOT NULL DEFAULT false,
  is_active boolean NOT NULL DEFAULT true,
  accessibility varchar(20) NOT NULL CHECK (accessibility IN ('standard', 'step_free'))
);

CREATE TABLE poi_operating_hours (
  poi_id uuid NOT NULL REFERENCES pois(id) ON DELETE CASCADE,
  day_of_week smallint NOT NULL CHECK (day_of_week BETWEEN 0 AND 6),
  opens_at time NOT NULL,
  closes_at time NOT NULL,
  CHECK (opens_at < closes_at),
  PRIMARY KEY (poi_id, day_of_week)
);

CREATE INDEX pois_location_gist_idx ON pois USING gist (location);
CREATE INDEX pois_public_category_idx ON pois (category_id, slug) WHERE status = 'published';
CREATE INDEX poi_entrances_location_gist_idx ON poi_entrances USING gist (location);
CREATE UNIQUE INDEX poi_one_primary_active_entrance_idx
  ON poi_entrances (poi_id) WHERE is_primary AND is_active;

COMMIT;
