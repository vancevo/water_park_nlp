BEGIN;

-- Migration 002 provided five fictional places so the original vertical slice
-- had data. The numbered Dam Sen import is now the runtime catalogue, so remove
-- those legacy fixtures without touching their shared categories or test files.
DELETE FROM semantic_embeddings
WHERE entity_type = 'poi'
  AND entity_id IN (
    '00000000-0000-4000-8000-000000000101',
    '00000000-0000-4000-8000-000000000102',
    '00000000-0000-4000-8000-000000000103',
    '00000000-0000-4000-8000-000000000104',
    '00000000-0000-4000-8000-000000000105'
  );

DELETE FROM pois
WHERE source = 'synthetic_fixture'
  AND id IN (
    '00000000-0000-4000-8000-000000000101',
    '00000000-0000-4000-8000-000000000102',
    '00000000-0000-4000-8000-000000000103',
    '00000000-0000-4000-8000-000000000104',
    '00000000-0000-4000-8000-000000000105'
  );

COMMIT;
