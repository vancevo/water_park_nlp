BEGIN;

-- Only categories nobody uses can go; a category in use keeps the migration from
-- silently orphaning places (the FK would reject the delete otherwise).
DELETE FROM poi_categories c
WHERE c.slug IN ('gate', 'ride', 'thrill_ride', 'children', 'interactive', 'food', 'restroom', 'parking', 'first_aid')
  AND NOT EXISTS (SELECT 1 FROM pois p WHERE p.category_id = c.id);

COMMIT;
