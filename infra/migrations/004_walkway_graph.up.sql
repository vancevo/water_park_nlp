BEGIN;

CREATE EXTENSION IF NOT EXISTS postgis;
CREATE EXTENSION IF NOT EXISTS pgrouting;

CREATE TABLE walk_nodes (
  id bigint PRIMARY KEY,
  external_id varchar(100) NOT NULL UNIQUE,
  location geometry(Point, 4326) NOT NULL,
  kind varchar(30) NOT NULL DEFAULT 'junction',
  source varchar(100) NOT NULL,
  CONSTRAINT walk_nodes_valid_geometry CHECK (ST_IsValid(location))
);

CREATE TABLE walk_edges (
  id bigint PRIMARY KEY,
  external_id varchar(100) NOT NULL UNIQUE,
  source bigint NOT NULL REFERENCES walk_nodes(id),
  target bigint NOT NULL REFERENCES walk_nodes(id),
  geom geometry(LineString, 4326) NOT NULL,
  length_m double precision NOT NULL CHECK (length_m > 0),
  cost double precision NOT NULL CHECK (cost > 0),
  reverse_cost double precision NOT NULL CHECK (reverse_cost = -1 OR reverse_cost > 0),
  accessibility varchar(20) NOT NULL CHECK (accessibility IN ('standard', 'step_free', 'stairs')),
  status varchar(20) NOT NULL CHECK (status IN ('open', 'closed')),
  surface varchar(30) NOT NULL DEFAULT 'unknown',
  source_name varchar(100) NOT NULL,
  CONSTRAINT walk_edges_distinct_nodes CHECK (source <> target),
  CONSTRAINT walk_edges_valid_geometry CHECK (ST_IsValid(geom) AND ST_NPoints(geom) >= 2)
);

CREATE INDEX walk_nodes_location_gist_idx ON walk_nodes USING gist (location);
CREATE INDEX walk_edges_geom_gist_idx ON walk_edges USING gist (geom);
CREATE INDEX walk_edges_route_filter_idx ON walk_edges (status, accessibility, source, target);

-- Deterministic graph from docs/product/SAMPLE_DATA_SPEC.md. The IDs are stable
-- across resets and the geometry is explicitly synthetic (not for real navigation).
INSERT INTO walk_nodes (id, external_id, location, kind, source) VALUES
  (1, 'N1', ST_SetSRID(ST_MakePoint(106.63470, 10.76700), 4326), 'visitor_start', 'synthetic_fixture'),
  (2, 'N2', ST_SetSRID(ST_MakePoint(106.63500, 10.76700), 4326), 'poi_entrance', 'synthetic_fixture'),
  (3, 'N3', ST_SetSRID(ST_MakePoint(106.63535, 10.76700), 4326), 'poi_entrance', 'synthetic_fixture'),
  (4, 'N4', ST_SetSRID(ST_MakePoint(106.63570, 10.76700), 4326), 'poi_entrance', 'synthetic_fixture'),
  (5, 'N5', ST_SetSRID(ST_MakePoint(106.63500, 10.76730), 4326), 'junction', 'synthetic_fixture'),
  (6, 'N6', ST_SetSRID(ST_MakePoint(106.63535, 10.76730), 4326), 'poi_entrance', 'synthetic_fixture'),
  (7, 'N7', ST_SetSRID(ST_MakePoint(106.63570, 10.76730), 4326), 'poi_entrance', 'synthetic_fixture')
ON CONFLICT (id) DO NOTHING;

WITH edge_input(id, external_id, source, target, coordinates, accessibility) AS (
  VALUES
    (1::bigint, 'N1-N2', 1::bigint, 2::bigint, '[[106.63470,10.76700],[106.63500,10.76700]]'::jsonb, 'step_free'),
    (2, 'N2-N3', 2, 3, '[[106.63500,10.76700],[106.63535,10.76700]]', 'step_free'),
    (3, 'N3-N4', 3, 4, '[[106.63535,10.76700],[106.63570,10.76700]]', 'step_free'),
    (4, 'N2-N5', 2, 5, '[[106.63500,10.76700],[106.63500,10.76730]]', 'step_free'),
    (5, 'N3-N6', 3, 6, '[[106.63535,10.76700],[106.63535,10.76730]]', 'stairs'),
    (6, 'N4-N7', 4, 7, '[[106.63570,10.76700],[106.63570,10.76730]]', 'step_free'),
    (7, 'N5-N6', 5, 6, '[[106.63500,10.76730],[106.63535,10.76730]]', 'step_free'),
    (8, 'N6-N7', 6, 7, '[[106.63535,10.76730],[106.63570,10.76730]]', 'step_free')
), edge_geometry AS (
  SELECT id, external_id, source, target,
    ST_SetSRID(ST_GeomFromGeoJSON(jsonb_build_object('type', 'LineString', 'coordinates', coordinates)), 4326) AS geom,
    accessibility
  FROM edge_input
)
INSERT INTO walk_edges (id, external_id, source, target, geom, length_m, cost, reverse_cost, accessibility, status, surface, source_name)
SELECT id, external_id, source, target, geom,
  ST_Length(geom::geography), ST_Length(geom::geography), ST_Length(geom::geography),
  accessibility, 'open', CASE WHEN accessibility = 'stairs' THEN 'steps' ELSE 'paved' END, 'synthetic_fixture'
FROM edge_geometry
ON CONFLICT (id) DO NOTHING;

-- The foreign key is added after the graph exists so earlier POI migrations stay
-- independently deployable. It catches unknown graph references on all new writes.
ALTER TABLE poi_entrances
  ADD CONSTRAINT poi_entrances_graph_node_ref_fk
  FOREIGN KEY (graph_node_ref) REFERENCES walk_nodes(external_id);

COMMIT;
