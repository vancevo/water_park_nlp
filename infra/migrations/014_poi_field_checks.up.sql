BEGIN;

-- Field checks: what a person measured standing at a place (or its entrance).
-- They never change the POI by themselves; a reviewer applies one (see
-- AdminPoi/FieldCheck endpoints), so published places stay published.
CREATE TABLE poi_field_checks (
  id uuid PRIMARY KEY,
  client_id uuid NOT NULL UNIQUE,
  poi_id uuid NOT NULL REFERENCES pois(id) ON DELETE CASCADE,
  target varchar(10) NOT NULL CHECK (target IN ('poi', 'entrance')),
  entrance_id uuid,
  location geography(Point, 4326) NOT NULL,
  accuracy_m double precision NOT NULL CHECK (accuracy_m > 0),
  sample_count integer NOT NULL CHECK (sample_count >= 1),
  outcome varchar(12) NOT NULL CHECK (outcome IN ('confirmed', 'corrected', 'problem')),
  path_ok boolean,
  note text CHECK (note IS NULL OR char_length(note) <= 500),
  distance_from_current_m double precision NOT NULL CHECK (distance_from_current_m >= 0),
  created_by uuid NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  applied_at timestamptz,
  applied_by uuid,
  CONSTRAINT poi_field_checks_entrance_target CHECK (
    (target = 'entrance') = (entrance_id IS NOT NULL)
  )
);

CREATE INDEX poi_field_checks_poi_idx ON poi_field_checks (poi_id, created_at DESC);
CREATE INDEX poi_field_checks_unapplied_idx ON poi_field_checks (created_at DESC) WHERE applied_at IS NULL;

COMMIT;
