BEGIN;

-- Security office (a service point on the park map, next to first aid).
INSERT INTO poi_categories (id, slug) VALUES
  ('10000000-0000-4000-8000-000000000015', 'security')
ON CONFLICT DO NOTHING;

COMMIT;
