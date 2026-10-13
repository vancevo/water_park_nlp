BEGIN;

DROP INDEX domain_outbox_pending_idx;
ALTER TABLE domain_outbox
  DROP COLUMN dead_lettered_at,
  DROP COLUMN next_attempt_at;
CREATE INDEX domain_outbox_pending_idx
  ON domain_outbox (created_at)
  WHERE published_at IS NULL;

COMMIT;
