BEGIN;

-- Only an unused category can go; the FK keeps the migration from orphaning places.
DELETE FROM poi_categories c
WHERE c.slug = 'security'
  AND NOT EXISTS (SELECT 1 FROM pois p WHERE p.category_id = c.id);

COMMIT;
