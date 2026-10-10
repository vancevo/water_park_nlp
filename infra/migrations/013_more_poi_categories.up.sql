BEGIN;

-- Categories editors can pick when marking places on site (gate, ride, food, ...).
-- The first five (garden..landmark) come from the seed migration 002.
INSERT INTO poi_categories (id, slug) VALUES
  ('10000000-0000-4000-8000-000000000006', 'gate'),
  ('10000000-0000-4000-8000-000000000007', 'ride'),
  ('10000000-0000-4000-8000-000000000008', 'thrill_ride'),
  ('10000000-0000-4000-8000-000000000009', 'children'),
  ('10000000-0000-4000-8000-000000000010', 'interactive'),
  ('10000000-0000-4000-8000-000000000011', 'food'),
  ('10000000-0000-4000-8000-000000000012', 'restroom'),
  ('10000000-0000-4000-8000-000000000013', 'parking'),
  ('10000000-0000-4000-8000-000000000014', 'first_aid')
ON CONFLICT DO NOTHING;

COMMIT;
